import tl = require('vsts-task-lib/task');
import path = require('path');
import fs = require('fs');
import * as ParameterParser from './parameterparser'

var azureRESTUtility = require ('azurerest-common/azurerestutility.js');
var msDeployUtility = require('webdeployment-common/msdeployutility.js');
var zipUtility = require('webdeployment-common/ziputility.js');
var deployUtility = require('webdeployment-common/utility.js');
var msDeploy = require('webdeployment-common/deployusingmsdeploy.js');
var fileTransformationsUtility = require('webdeployment-common/fileTransformationsUtility.js');
var kuduUtility = require('./kuduutility.js');
var generateWebConfigUtil = require('webdeployment-common/webconfigutil.js');
var deployWebAppImage = require("./azurermwebappcontainerdeployment").deployWebAppImage;

async function run() {
    try {

        tl.setResourcePath(path.join( __dirname, 'task.json'));
        var connectedServiceName = tl.getInput('ConnectedServiceName', true);
        var webAppName: string = tl.getInput('WebAppName', true);
        var deployToSlotFlag: boolean = tl.getBoolInput('DeployToSlotFlag', false);
        var resourceGroupName: string = tl.getInput('ResourceGroupName', false);
        var slotName: string = tl.getInput('SlotName', false);
        var webDeployPkg: string = tl.getPathInput('Package', true);
        var virtualApplication: string = tl.getInput('VirtualApplication', false);
        var useWebDeploy: boolean = tl.getBoolInput('UseWebDeploy', false);
        var setParametersFile: string = tl.getPathInput('SetParametersFile', false);
        var removeAdditionalFilesFlag: boolean = tl.getBoolInput('RemoveAdditionalFilesFlag', false);
        var excludeFilesFromAppDataFlag: boolean = tl.getBoolInput('ExcludeFilesFromAppDataFlag', false);
        var takeAppOfflineFlag: boolean = tl.getBoolInput('TakeAppOfflineFlag', false);
        var renameFilesFlag: boolean = tl.getBoolInput('RenameFilesFlag', false);
        var additionalArguments: string = tl.getInput('AdditionalArguments', false);
        var webAppUri:string = tl.getInput('WebAppUri', false);
        var xmlTransformation: boolean = tl.getBoolInput('XmlTransformation', false);
        var JSONFiles = tl.getDelimitedInput('JSONFiles', '\n', false);
        var xmlVariableSubstitution: boolean = tl.getBoolInput('XmlVariableSubstitution', false);
        var scriptType: string = tl.getInput('ScriptType', false);
        var inlineScript: string = tl.getInput('InlineScript', false);
        var scriptPath: string = tl.getPathInput('ScriptPath', false);
        var endPointAuthCreds = tl.getEndpointAuthorization(connectedServiceName, true);
        var generateWebConfig = tl.getBoolInput('GenerateWebConfig', false);
        var webConfigParametersStr = tl.getInput('WebConfigParameters', false);
        var webAppKind = tl.getInput('WebAppKind', false);
        var dockerNamespace = tl.getInput('DockerNamespace', false);
        var isDeploymentSuccess: boolean = true;
        var tempPackagePath = null;

        var endPoint = new Array();
        endPoint["servicePrincipalClientID"] = tl.getEndpointAuthorizationParameter(connectedServiceName, 'serviceprincipalid', true);
        endPoint["servicePrincipalKey"] = tl.getEndpointAuthorizationParameter(connectedServiceName, 'serviceprincipalkey', true);
        endPoint["tenantID"] = tl.getEndpointAuthorizationParameter(connectedServiceName, 'tenantid', true);
        endPoint["subscriptionId"] = tl.getEndpointDataParameter(connectedServiceName, 'subscriptionid', true);
        endPoint["envAuthUrl"] = tl.getEndpointDataParameter(connectedServiceName, 'environmentAuthorityUrl', true);
        endPoint["url"] = tl.getEndpointUrl(connectedServiceName, true);

        if(webAppKind && webAppKind === "linux") {
            deployToSlotFlag = false;
        }

        if(deployToSlotFlag) {
            if (slotName.toLowerCase() === "production") {
                deployToSlotFlag = false;
            }
        }
        else {
            resourceGroupName = await azureRESTUtility.getResourceGroupName(endPoint, webAppName);
        }

        var publishingProfile = await azureRESTUtility.getAzureRMWebAppPublishProfile(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName);
        console.log(tl.loc('GotconnectiondetailsforazureRMWebApp0', webAppName));

        // For container based linux deployment
        if(webAppKind && webAppKind === "linux" && dockerNamespace)
        {
            tl.debug("Performing container based deployment.");

            await deployWebAppImage(endPoint, resourceGroupName, webAppName);
        }
        else
        {
            tl.debug("Performing the deployment of webapp.");

            var availableWebPackages = deployUtility.findfiles(webDeployPkg);
            if(availableWebPackages.length == 0) {
                throw new Error(tl.loc('Nopackagefoundwithspecifiedpattern'));
            }

            if(availableWebPackages.length > 1) {
                throw new Error(tl.loc('MorethanonepackagematchedwithspecifiedpatternPleaserestrainthesearchpattern'));
            }
            webDeployPkg = availableWebPackages[0];

            var azureWebAppDetails = null;
            var virtualApplicationPhysicalPath = null;
            if(virtualApplication) {
                virtualApplication = (virtualApplication.startsWith("/")) ? virtualApplication.substr(1) : virtualApplication;
                azureWebAppDetails = await azureRESTUtility.getAzureRMWebAppConfigDetails(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName);
                var virtualApplicationMappings = azureWebAppDetails.properties.virtualApplications;
                var pathMappings = kuduUtility.getVirtualAndPhysicalPaths(virtualApplication, virtualApplicationMappings);
                if(pathMappings[1] != null) {
                    virtualApplicationPhysicalPath = pathMappings[1];
                    await kuduUtility.ensurePhysicalPathExists(publishingProfile, pathMappings[1]);
                }
                else {
                    throw Error(tl.loc("VirtualApplicationDoesNotExist", virtualApplication));
                }
            }
            var isFolderBasedDeployment = deployUtility.isInputPkgIsFolder(webDeployPkg);
            var applyFileTransformFlag = JSONFiles.length != 0 || xmlTransformation || xmlVariableSubstitution;

            if (applyFileTransformFlag || generateWebConfig) {
                var folderPath = await deployUtility.generateTemporaryFolderForDeployment(isFolderBasedDeployment, webDeployPkg);

                if (generateWebConfig) {
                    tl.debug('parsing web.config parameters');
                    var webConfigParameters = ParameterParser.parse(webConfigParametersStr);
                    generateWebConfigUtil.addWebConfigFile(folderPath, webConfigParameters, virtualApplicationPhysicalPath);
                }
                if (applyFileTransformFlag) {
                    var isMSBuildPackage = !isFolderBasedDeployment  && (await deployUtility.isMSDeployPackage(webDeployPkg));
                    fileTransformationsUtility.fileTransformations(isFolderBasedDeployment, JSONFiles, xmlTransformation, xmlVariableSubstitution, folderPath, isMSBuildPackage);
                }

                var output = await deployUtility.archiveFolderForDeployment(isFolderBasedDeployment, folderPath);
                tempPackagePath = output.tempPackagePath;
                webDeployPkg = output.webDeployPkg;
            }

            if(virtualApplication) {
                publishingProfile.destinationAppUrl += "/" + virtualApplication;
            }

            if(webAppUri) {
                tl.setVariable(webAppUri, publishingProfile.destinationAppUrl);
            }

        if(publishingProfile && publishingProfile.destinationAppUrl) {
            try{
                await azureRESTUtility.testAzureWebAppAvailability(publishingProfile.destinationAppUrl, 3000);
            } catch (error) {
                tl.debug("Failed to check availability of azure web app, error : " + error.message);
            }
        }

        if(deployUtility.canUseWebDeploy(useWebDeploy)) {
            if(!tl.osType().match(/^Win/)){
                throw Error(tl.loc("PublishusingwebdeployoptionsaresupportedonlywhenusingWindowsagent"));
            }

                var appSettings = await azureRESTUtility.getWebAppAppSettings(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName);
                if(renameFilesFlag) {
                    if(appSettings.properties.MSDEPLOY_RENAME_LOCKED_FILES == undefined || appSettings.properties.MSDEPLOY_RENAME_LOCKED_FILES == '0'){
                        appSettings.properties.MSDEPLOY_RENAME_LOCKED_FILES = '1';
                        await azureRESTUtility.updateWebAppAppSettings(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName, appSettings);
                    }
                }
                else {
                    if(appSettings.properties.MSDEPLOY_RENAME_LOCKED_FILES != undefined && appSettings.properties.MSDEPLOY_RENAME_LOCKED_FILES != '0'){
                        delete appSettings.properties.MSDEPLOY_RENAME_LOCKED_FILES;
                        await azureRESTUtility.updateWebAppAppSettings(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName, appSettings);
                    }
                }
                console.log("##vso[task.setvariable variable=websiteUserName;issecret=true;]" + publishingProfile.userName);
                console.log("##vso[task.setvariable variable=websitePassword;issecret=true;]" + publishingProfile.userPWD);
                await msDeploy.DeployUsingMSDeploy(webDeployPkg, webAppName, publishingProfile, removeAdditionalFilesFlag,
                                excludeFilesFromAppDataFlag, takeAppOfflineFlag, virtualApplication, setParametersFile,
                                additionalArguments, isFolderBasedDeployment, useWebDeploy);
        } else {
            tl.debug("Initiated deployment via kudu service for webapp package : " + webDeployPkg);
            if(azureWebAppDetails == null) {
                azureWebAppDetails = await azureRESTUtility.getAzureRMWebAppConfigDetails(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName);
            }
            await DeployUsingKuduDeploy(webDeployPkg, azureWebAppDetails, publishingProfile, virtualApplication, isFolderBasedDeployment, takeAppOfflineFlag);

        }
        if(scriptType) {
            var kuduWorkingDirectory = virtualApplication ? virtualApplicationPhysicalPath : 'site/wwwroot';
            await kuduUtility.runPostDeploymentScript(publishingProfile, kuduWorkingDirectory, scriptType, inlineScript, scriptPath, takeAppOfflineFlag);
        }
        await updateScmType(endPoint, webAppName, resourceGroupName, deployToSlotFlag, slotName);

        }
    }
    catch (error) {
        isDeploymentSuccess = false;
        tl.setResult(tl.TaskResult.Failed, error);
    }
    if(publishingProfile != null) {
        var customMessage = {
            type: "Deployment",
            slotName: (deployToSlotFlag ? slotName : "Production")
        };

        try {
            console.log(await azureRESTUtility.updateDeploymentStatus(publishingProfile, isDeploymentSuccess, customMessage));
        }
        catch(error) {
            tl.warning(error);
        }
    }
    if(tempPackagePath) {
        tl.rmRF(tempPackagePath);
    }
}


/**
 * Deploys website using Kudu REST API
 *
 * @param   webDeployPkg                   Web deploy package
 * @param   webAppName                     Web App Name
 * @param   publishingProfile              Azure RM Connection Details
 * @param   virtualApplication             Virtual Application Name
 * @param   isFolderBasedDeployment        Input is folder or not
 *
 */
async function DeployUsingKuduDeploy(webDeployPkg, azureWebAppDetails, publishingProfile, virtualApplication, isFolderBasedDeployment, takeAppOfflineFlag) {
    var tempPackagePath = null;
    try {
        var virtualApplicationMappings = azureWebAppDetails.properties.virtualApplications;
        var webAppZipFile = webDeployPkg;
        if(isFolderBasedDeployment) {
            tempPackagePath = deployUtility.generateTemporaryFolderOrZipPath(tl.getVariable('System.DefaultWorkingDirectory'), false);
            webAppZipFile = await zipUtility.archiveFolder(webDeployPkg, "", tempPackagePath);
            tl.debug("Compressed folder " + webDeployPkg + " into zip : " +  webAppZipFile);
        } else {
            if (await deployUtility.isMSDeployPackage(webAppZipFile)) {
                throw new Error(tl.loc("MSDeploygeneratedpackageareonlysupportedforWindowsplatform"));
            }
        }
        var physicalPath = "/site/wwwroot";
        var virtualPath = "/";
        if(virtualApplication) {
            var pathMappings = kuduUtility.getVirtualAndPhysicalPaths(virtualApplication, virtualApplicationMappings);
            if(pathMappings[1] != null) {
                virtualPath = pathMappings[0];
                physicalPath = pathMappings[1];
            } else {
                throw Error(tl.loc("VirtualApplicationDoesNotExist", virtualApplication));
            }
        }
        await kuduUtility.deployWebAppPackage(webAppZipFile, publishingProfile, virtualPath, physicalPath, takeAppOfflineFlag);
        console.log(tl.loc('PackageDeploymentSuccess'));
    }
    catch(error) {
        tl.error(tl.loc('PackageDeploymentFailed'));
        throw Error(error);
    }
    finally {
        if(tempPackagePath) {
            tl.rmRF(tempPackagePath, true);
        }
    }
}

async function updateScmType(SPN, webAppName: string, resourceGroupName: string, deployToSlotFlag: boolean, slotName: string) {
    try {
        var configDetails = await azureRESTUtility.getAzureRMWebAppConfigDetails(SPN, webAppName, resourceGroupName, deployToSlotFlag, slotName);
        var scmType: string = configDetails.properties.scmType;
        if(scmType.toLowerCase() === "none") {
            var updatedConfigDetails = JSON.stringify(
                {
                    "properties": {
                        "scmType": "VSTSRM"
                    }
                });
            await azureRESTUtility.updateAzureRMWebAppConfigDetails(SPN, webAppName, resourceGroupName, deployToSlotFlag, slotName, updatedConfigDetails);
            console.log(tl.loc("SuccessfullyUpdatedAzureRMWebAppConfigDetails"));
        }
    }
    catch(error) {
        tl.warning(tl.loc("FailedToUpdateAzureRMWebAppConfigDetails", error));
    }
}


run();
