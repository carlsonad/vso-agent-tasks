import ma = require('vsts-task-lib/mock-answer');
import tmrm = require('vsts-task-lib/mock-run');
import path = require('path');

let taskPath = path.join(__dirname, '..', 'main.js');
let tr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(taskPath);

tr.setInput("action", "Create Or Update Resource Group");
tr.setInput("ConnectedServiceName", "AzureRM");
tr.setInput("resourceGroupName", process.env["resourceGroupName"]);
tr.setInput("location", "West US");
tr.setInput("templateLocation", "Linked artifact")
tr.setInput("overrideParameters", "");
tr.setInput("deploymentMode", "Complete");
tr.setInput("enableDeploymentPrerequisites", "ConfigureVMwithWinRM");
tr.setInput("csmFile", path.join(__dirname, "CSM.json"));
tr.setInput("csmParametersFile", path.join(__dirname, "CSM.json"));

process.env["ENDPOINT_AUTH_AzureRM"] = "{\"parameters\":{\"serviceprincipalid\":\"id\",\"serviceprincipalkey\":\"key\",\"tenantid\":\"tenant\"},\"scheme\":\"ServicePrincipal\"}";
process.env["ENDPOINT_DATA_AzureRM_SUBSCRIPTIONID"] = "sId";
process.env["ENDPOINT_DATA_AzureRM_SUBSCRIPTIONNAME"] = "sName";
process.env["ENDPOINT_URL_AzureRM"] = "https://management.azure.com/";
process.env["ENDPOINT_DATA_AzureRM_ENVIRONMENTAUTHORITYURL"] = "https://login.windows.net/";

tr.registerMock('vsts-task-lib/toolrunner', require('vsts-task-lib/mock-toolrunner'));
tr.registerMock('./azure-rest/azure-arm-compute', require('./mock_node_modules/azure-arm-compute'));
tr.registerMock('./azure-rest/azure-arm-network', require('./mock_node_modules/azure-arm-network'));
tr.registerMock('./azure-rest/azure-arm-resource', require('./mock_node_modules/azure-arm-resource'));
tr.run();