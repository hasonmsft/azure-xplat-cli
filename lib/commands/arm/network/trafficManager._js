var __ = require('underscore');
var util = require('util');
var utils = require('../../../util/utils');
var resourceUtils = require('../resource/resourceUtils');
var tagUtils = require('../tag/tagUtils');
var constants = require('./constants');
var $ = utils.getLocaleString;

function Traffic(cli, trafficManagerProviderClient) {
  this.cli = cli;
  this.log = cli.output;
  this.trafficManagerProviderClient = trafficManagerProviderClient;
}

__.extend(Traffic.prototype, {
  create: function (resourceGroupName, name, options, _) {
    var tmProfile = this.get(resourceGroupName, name, _);

    if (tmProfile) {
      throw new Error(util.format($('traffic management profile with name "%s" already exists in resource group "%s"'), name, resourceGroupName));
    }

    var progress = this.cli.interaction.progress(util.format($('Creating traffic manager profile "%s"'), name));
    var parameters = {
      profile: this._parseProfile(options, true)
    };

    try {
      this.trafficManagerProviderClient.profiles.createOrUpdate(resourceGroupName, name, parameters, _);
    } catch (e) {
      throw e;
    } finally {
      progress.end();
    }
  },

  list: function (resourceGroupName, options, _) {
    var progress = this.cli.interaction.progress($('Getting traffic manager profiles'));
    var tmProfiles = null;
    try {
      tmProfiles = this.trafficManagerProviderClient.profiles.listAllInResourceGroup(resourceGroupName, _);
    } finally {
      progress.end();
    }

    var output = this.cli.output;
    this.cli.interaction.formatOutput(tmProfiles.profiles, function (outputData) {
      if (outputData.length === 0) {
        output.warn($('No traffic manager profiles found in resource group %s', resourceGroupName));
      } else {
        output.table(outputData, function (row, item) {
          row.cell($('Name'), item.name);
          row.cell($('Location'), item.location);
          row.cell($('DNS name'), item.properties.dnsConfig.relativeName);
          row.cell($('Monitoring protocol'), item.properties.monitorConfig.protocol);
        });
      }
    });
  },

  show: function (resourceGroupName, name, options, _) {
    var tmProfile = this.get(resourceGroupName, name, _);

    var output = this.cli.output;
    if (!tmProfile) {
      if (output.format().json) {
        output.json({});
      } else {
        output.warn(util.format($('A traffic manager profile with name "%s" not found in the resource group "%s"'), name, resourceGroupName));
      }
      return;
    }
    this._showProfile(tmProfile.profile);
  },

  get: function (resourceGroupName, name, _) {
    var progress = this.cli.interaction.progress(util.format($('Looking up the traffic manager profile "%s"'), name));
    try {
      var tmProfile = this.trafficManagerProviderClient.profiles.get(resourceGroupName, name, _);
      return tmProfile;
    } catch (e) {
      if (e.code === 'ResourceNotFound') {
        return null;
      }
      throw e;
    } finally {
      progress.end();
    }
  },

  delete: function (resourceGroupName, name, options, _) {
    var tmProfile = this.get(resourceGroupName, name, _);
    if (!tmProfile) {
      throw new Error(util.format('Traffic manager profile with name "%s" not found', name));
    }

    if (!options.quiet && !this.cli.interaction.confirm(util.format($('Delete traffic manager profile %s? [y/n] '), name), _)) {
      return;
    }

    var progress = this.cli.interaction.progress(util.format($('Deleting traffic manager profile "%s"'), name));
    try {
      this.trafficManagerProviderClient.profiles.deleteMethod(resourceGroupName, name, _);
    } catch (e) {
      throw e;
    } finally {
      progress.end();
    }
  },

  checkDnsAvailability: function (resourceGroupName, relativeDnsName, options, _) {
    var progress = this.cli.interaction.progress($('Getting traffic manager profiles'));
    var tmProfiles = null;
    try {
      tmProfiles = this.trafficManagerProviderClient.profiles.listAllInResourceGroup(resourceGroupName, _);
    } finally {
      progress.end();
    }

    var existingProfile = utils.findFirstCaseIgnore(tmProfiles.profiles, {relativeName: relativeDnsName});
    if (existingProfile) {
      this.log.info(util.format($('The traffic manager profile with DNS relative name "%s" already exists in resource group "%s". This DNS name is not available'), relativeDnsName, resourceGroupName));
      this._showProfile(resourceGroupName, relativeDnsName);
    } else {
      this.log.info(util.format($('DNS relative name %s is available in resource group "%s"'), relativeDnsName, resourceGroupName));
    }
  },

  createEndpoint: function (resourceGroupName, profileName, endpointName, params, _) {
    var endpoint = this._parseEndpoint(endpointName, params, true);
    var trafficManager = this.get(resourceGroupName, profileName, _);
    if (!trafficManager) {
      throw new Error(util.format($('A traffic manager with name "%s" not found in the resource group "%s"'), profileName, resourceGroupName));
    }

    var output = this.cli.output;
    var ep = utils.findFirstCaseIgnore(trafficManager.profile.properties.endpoints, {name: endpointName});

    if (ep) {
      output.error(util.format($('An endpoint with name "%s" already exist in traffic manager "%s"'), endpointName, profileName));
    } else {
      trafficManager.profile.properties.endpoints.push(endpoint);
      this.update(resourceGroupName, profileName, trafficManager, _);
      this.show(resourceGroupName, profileName, params, _);
    }
  },

  setEndpoint: function (resourceGroupName, profileName, endpointName, params, _) {
    var endpoint = this._parseEndpoint(endpointName, params, false);
    var trafficManager = this.get(resourceGroupName, profileName, _);
    if (!trafficManager) {
      throw new Error(util.format($('A traffic manager with name "%s" not found in the resource group "%s"'), profileName, resourceGroupName));
    }

    var output = this.cli.output;
    var ep = utils.findFirstCaseIgnore(trafficManager.profile.properties.endpoints, {name: endpointName});

    if (ep) {
      if (params.type) ep.type = endpoint.type;
      if (params.target) ep.properties.target = endpoint.properties.target;
      if (params.endpointStatus) ep.properties.endpointStatus = endpoint.properties.endpointStatus;
      if (params.weight) ep.properties.weight = endpoint.properties.weight;
      if (params.priority) ep.properties.priority = endpoint.properties.priority;
      this.update(resourceGroupName, profileName, trafficManager, _);
    } else {
      output.error(util.format($('An endpoint with name "%s" not found in traffic manager "%s"'), endpointName, profileName));
    }
  },

  deleteEndpoint: function (resourceGroupName, profileName, endpointName, params, _) {
    var trafficManager = this.get(resourceGroupName, profileName, _);
    if (!trafficManager) {
      throw new Error(util.format($('A traffic manager with name "%s" not found in the resource group "%s"'), profileName, resourceGroupName));
    }

    var output = this.cli.output;
    var index = utils.indexOfCaseIgnore(trafficManager.profile.properties.endpoints, {name: endpointName});

    if (index !== null) {
      if (!params.quiet && !this.cli.interaction.confirm(util.format($('Delete an endpoint "%s?" [y/n] '), endpointName), _)) {
        return;
      }

      trafficManager.profile.properties.endpoints.splice(index, 1);
      this.update(resourceGroupName, profileName, trafficManager, _);
    } else {
      output.error(util.format($('An endpoint with name "%s" not found in traffic manager "%s"'), endpointName, profileName));
    }
  },

  update: function (resourceGroupName, profileName, trafficManager, _) {
    var progress = this.cli.interaction.progress(util.format($('Updating traffic manager "%s"'), profileName));
    try {
      this.trafficManagerProviderClient.profiles.createOrUpdate(resourceGroupName, profileName, trafficManager, _);
    } catch (e) {
      throw e;
    } finally {
      progress.end();
    }
  },

  _parseEndpoint: function (endpointName, params, useDefaults) {
    var self = this;
    var output = self.cli.output;

    var endpoint = {
      name: endpointName,
      properties: {}
    };

    if (params.type) {
      endpoint.type = utils.verifyParamExistsInCollection(constants.TM_VALID_ENDPOINT_TYPES,
        params.type, 'endpoint type');

      if (endpoint.type == constants.TM_VALID_ENDPOINT_TYPES[0]) {
        endpoint.type = 'Microsoft.Network/trafficmanagerprofiles/ExternalEndpoints';
      }
    }

    if (params.target) {
      if (utils.stringIsNullOrEmpty(params.target)) {
        throw new Error($('Target parameter must not be null or empty string'));
      }
      endpoint.properties.target = utils.trimTrailingChar(params.target, '.');
    }

    if (params.endpointStatus) {
      endpoint.properties.endpointStatus = utils.verifyParamExistsInCollection(constants.TM_VALID_ENDPOINT_STATUSES,
        params.endpointStatus, 'endpoint status');
    } else if (useDefaults) {
      output.warn(util.format($('Using default endpoint status: %s'), constants.TM_VALID_ENDPOINT_STATUSES[0]));
      endpoint.properties.endpointStatus = constants.TM_VALID_ENDPOINT_STATUSES[0];
    }

    if (params.weight) {
      var weightAsInt = utils.parseInt(params.weight);
      if (weightAsInt != params.weight) {
        throw new Error($('Weight parameter must be an integer'));
      }
      endpoint.properties.weight = params.weight;
    }

    if (params.priority) {
      var priorityAsInt = utils.parseInt(params.priority);
      if (priorityAsInt != params.priority) {
        throw new Error($('Priority parameter must be an integer'));
      }
      endpoint.properties.priority = params.priority;
    }

    if (params.location) {
      endpoint.location = params.location;
    }

    return endpoint;
  },

  _parseProfile: function (options, useDefaults) {
    var parameters = {};

    if (options.location) {
      parameters.location = options;
    } else {
      if (useDefaults) {
        parameters.location = constants.TM_DEFAULT_LOCATION;
      }
    }
    parameters.properties = {
      dnsConfig: {
        relativeName: options.relativeDnsName
      }
    };

    if (options.profileStatus) {
      if (!utils._isElemInArray(options.profileStatus, utils.profileStatusesEnum())) {
        throw new Error($('TrafficManager management profile status valid values are: %s', utils.profileStatusesStr()));
      }
      parameters.properties.profileStatus = options.profileStatus;
    } else {
      if (useDefaults) {
        parameters.properties.profileStatus = constants.TM_DEFAULT_PROFILE_STATUS;
      }
    }

    if (options.trafficRoutingMethod) {
      if (!utils._isElemInArray(options.trafficRoutingMethod, utils.trafficRoutingMethodsEnum())) {
        throw new Error($('TrafficManager routing method valid values are: %s', utils.trafficRoutingMethodsStr()));
      }
      parameters.properties.trafficRoutingMethod = options.trafficRoutingMethod;
    } else {
      if (useDefaults) {
        parameters.properties.trafficRoutingMethod = constants.TM_DEFAULT_TRAFFIC_ROUTING_METHOD;
      }
    }

    if (options.ttl) {
      var ttl = parseInt(options.ttl);
      if (!ttl || ttl < 0) {
        throw new Error('TrafficManager management time to live must be a positive integer value');
      }
      parameters.properties.dnsConfig.ttl = options.ttl;
    } else {
      if (useDefaults) {
        parameters.properties.dnsConfig.ttl = constants.TM_DEFAULT_TIME_TO_LIVE;
      }
    }

    parameters.properties.monitorConfig = {};
    if (options.monitorProtocol) {
      if (!utils._isElemInArray(options.monitorProtocol, utils.monitorProtocolsEnum())) {
        throw new Error($('TrafficManager routing method valid values are: %s', utils.monitorProtocolsStr()));
      }
      parameters.properties.monitorConfig.protocol = options.monitorProtocol;
    } else {
      if (useDefaults) {
        parameters.properties.monitorConfig.protocol = constants.TM_DEFAULT_MONITOR_PROTOCOL;
      }
    }

    if (options.monitorPort) {
      var monitorPort = parseInt(options.monitorPort);
      if (!monitorPort || monitorPort < 0) {
        throw new Error('TrafficManager management monitor port must be a positive integer value');
      }
      parameters.properties.monitorConfig.port = options.monitorPort;
    } else {
      if (useDefaults) {
        if (parameters.properties.monitorConfig.protocol === 'http') {
          parameters.properties.monitorConfig.port = constants.TM_DEFAULT_MONITOR_PORT.http;
        }
        if (parameters.properties.monitorConfig.protocol === 'https') {
          parameters.properties.monitorConfig.port = constants.TM_DEFAULT_MONITOR_PORT.https;
        }
      }
    }

    if (options.monitorPath) {
      parameters.properties.monitorConfig.path = options.monitorPath;
    } else {
      if (useDefaults) {
        parameters.properties.monitorConfig.path = '/';
      }
    }

    if (options.tags) {
      var tags = tagUtils.buildTagsParameter(null, options);
      parameters.tags = tags;
    } else {
      this.log.verbose($('No tags specified'));
    }

    parameters.properties.endpoints = [];
    return parameters;
  },

  _showProfile: function (tmProfile) {
    var resourceInfo = resourceUtils.getResourceInformation(tmProfile.id);

    var log = this.log;
    this.cli.interaction.formatOutput(tmProfile, function (tmProfile) {
      log.data($('Id:                    '), tmProfile.id);
      log.data($('Name:                  '), resourceInfo.resourceName || tmProfile.name);
      log.data($('Type:                  '), resourceInfo.resourceType || tmProfile.type);
      log.data($('Location:              '), tmProfile.location);
      log.data($('Profile status:        '), tmProfile.properties.profileStatus);
      log.data($('TrafficManager routing method:'), tmProfile.properties.trafficRoutingMethod);
      log.data($('DNS name:              '), tmProfile.properties.dnsConfig.relativeName);
      log.data($('Time to live:          '), tmProfile.properties.dnsConfig.ttl);
      log.data($('Source address prefix: '), tmProfile.properties.monitorConfig.protocol);
      log.data($('Monitoring port:       '), tmProfile.properties.monitorConfig.port);
      log.data($('Monitoring path:       '), tmProfile.properties.monitorConfig.path);

      if (tmProfile.properties.endpoints && tmProfile.properties.endpoints.length > 0) {
        log.data($('Profile endpoints:'));
        for (var i = 0; i < tmProfile.properties.endpoints.length; i++) {
          var endpoint = tmProfile.properties.endpoints[i];
          log.data('', endpoint.name + ' ' + endpoint.properties.target);
        }
      } else {
        log.data($('Endpoints:             '), '');
      }
    });
  }
});

module.exports = Traffic;