import networkManagementClient = require("./azure-rest/azure-arm-network");
import computeManagementClient = require("./azure-rest/azure-arm-compute");
import deployAzureRG = require("../models/DeployAzureRG");
import tl = require("vsts-task-lib/task")
import az = require("./azure-rest/azureModels");
import utils = require("./Utils");

export class NetworkInterface {
    Name: string;
    Id: string
}

export class VirtualMachine {
    Name: string;
    NetworkInterfaceIds: string[];
    WinRMHttpsPort: number;
    WinRMHttpsPublicAddress: string;
    Tags: any;

    constructor() {
        this.NetworkInterfaceIds = [];
        this.WinRMHttpsPort = 5986;
    }
}

export class LoadBalancer {
    Id: string;
    FrontEndPublicAddress: string
    FrontEndPortsInUse: number[];
    BackendNicIds: string[];

    constructor() {
        this.BackendNicIds = [];
        this.FrontEndPortsInUse = [];
    }
}

export class ResourceGroupDetails {
    VirtualMachines: VirtualMachine[];
    LoadBalancers: LoadBalancer[]

    constructor() {
        this.VirtualMachines = [];
        this.LoadBalancers = []
    }
}

export class AzureUtil {
    public loadBalancersDetails: az.LoadBalancer[];
    public vmDetails: az.VM[];
    public networkInterfaceDetails: az.NetworkInterface[];
    public publicAddressDetails: az.PublicIPAddress[];
    private taskParameters: deployAzureRG.AzureRGTaskParameters;
    private networkClient: networkManagementClient.NetworkManagementClient;
    private computeClient: computeManagementClient.ComputeManagementClient;

    constructor(taskParameters: deployAzureRG.AzureRGTaskParameters, computeClient?: computeManagementClient.ComputeManagementClient, networkClient?: networkManagementClient.NetworkManagementClient) {
        this.taskParameters = taskParameters;
        this.computeClient = computeClient || new computeManagementClient.ComputeManagementClient(this.taskParameters.credentials, this.taskParameters.subscriptionId);
        this.networkClient = networkClient || new networkManagementClient.NetworkManagementClient(this.taskParameters.credentials, this.taskParameters.subscriptionId);
    }

    public async getResourceGroupDetails(): Promise<ResourceGroupDetails> {
        await this.getDetails();
        var resourceGroupDetails = new ResourceGroupDetails();

        var fqdns = {}
        for (var publicAddress of this.publicAddressDetails) {
            fqdns[publicAddress.id] = publicAddress.properties.dnsSettings
                ? publicAddress.properties.dnsSettings.fqdn
                : publicAddress.properties.ipAddress;
        }

        var ipcToNicMap = {}
        for (var nic of this.networkInterfaceDetails) {
            for (var ipc of nic.properties.ipConfigurations) {
                ipcToNicMap[ipc.id] = nic.id;
            }
        }

        var ruleToPortAndAddressMap = {}
        for (var lb of this.loadBalancersDetails) {
            if (!lb.properties.frontendIPConfigurations || lb.properties.frontendIPConfigurations.length == 0 || !lb.properties.frontendIPConfigurations[0].properties.publicIPAddress) {
                continue;
            }

            var loadBalancer = new LoadBalancer();
            var publicAddressId = lb.properties.frontendIPConfigurations[0].properties.publicIPAddress.id;
            loadBalancer.FrontEndPublicAddress = fqdns[publicAddressId];
            loadBalancer.Id = lb.id;

            if (lb.properties.inboundNatRules) {
                for (var rule of lb.properties.inboundNatRules) {
                    loadBalancer.FrontEndPortsInUse.push(rule.properties.frontendPort);
                    if (rule.properties.backendPort === 5986 && rule.properties.backendIPConfiguration) {
                        ruleToPortAndAddressMap[rule.id] = {
                            FrontEndPort: rule.properties.frontendPort,
                            PublicAddress: loadBalancer.FrontEndPublicAddress
                        }
                    }
                }
            }

            if (lb.properties.backendAddressPools) {
                for (var pool of lb.properties.backendAddressPools) {
                    if (pool.properties.backendIPConfigurations) {
                        for (var ipc of pool.properties.backendIPConfigurations) {
                            loadBalancer.BackendNicIds.push(ipcToNicMap[ipc.id]);
                        }
                    }
                }
            }

            resourceGroupDetails.LoadBalancers.push(loadBalancer);
        }

        for (var vmDetail of this.vmDetails) {
            var virtualMachine = new VirtualMachine();
            virtualMachine.Name = vmDetail.name;
            virtualMachine.Tags = vmDetail.tags;
            if (vmDetail.properties.networkProfile && vmDetail.properties.networkProfile.networkInterfaces) {
                for (var vmNic of vmDetail.properties.networkProfile.networkInterfaces) {
                    virtualMachine.NetworkInterfaceIds.push(vmNic.id);
                    var networkInterface = this.networkInterfaceDetails.find(nic => nic.id == vmNic.id);
                    if (networkInterface.properties.ipConfigurations) {
                        for (var ipc of networkInterface.properties.ipConfigurations) {
                            if (ipc.properties.publicIPAddress && fqdns[ipc.properties.publicIPAddress.id]) {
                                virtualMachine.WinRMHttpsPort = 5986;
                                virtualMachine.WinRMHttpsPublicAddress = fqdns[ipc.properties.publicIPAddress.id];
                                break;
                            }

                            if (ipc.properties.loadBalancerInboundNatRules) {
                                for (var rule of ipc.properties.loadBalancerInboundNatRules) {
                                    if (ruleToPortAndAddressMap[rule.id]) {
                                        virtualMachine.WinRMHttpsPort = ruleToPortAndAddressMap[rule.id].FrontEndPort;
                                        virtualMachine.WinRMHttpsPublicAddress = ruleToPortAndAddressMap[rule.id].PublicAddress;
                                        break;
                                    }
                                }

                                if (virtualMachine.WinRMHttpsPublicAddress) {
                                    break;
                                }
                            }
                        }
                    }
                    if (virtualMachine.WinRMHttpsPublicAddress) {
                        break;
                    }
                }
            }

            resourceGroupDetails.VirtualMachines.push(virtualMachine);
        }

        return resourceGroupDetails;
    }

    public getLoadBalancers(): Promise<az.LoadBalancer[]> {
        return new Promise<any>((resolve, reject) => {
            this.networkClient.loadBalancers.list(this.taskParameters.resourceGroupName, (error, loadbalancers, request, response) => {
                if (error) {
                    return reject(tl.loc("FailedToFetchLoadBalancers", utils.getError(error)));
                }
                this.loadBalancersDetails = loadbalancers;
                resolve(loadbalancers);
            });
        });
    }

    public getVMDetails(): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.computeClient.virtualMachines.list(this.taskParameters.resourceGroupName, null, (error, virtualMachines, request, response) => {
                if (error) {
                    return reject(tl.loc("VM_ListFetchFailed", this.taskParameters.resourceGroupName, utils.getError(error)));
                }
                this.vmDetails = virtualMachines;
                resolve(virtualMachines);
            });
        });
    }

    public getNetworkInterfaceDetails(): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.networkClient.networkInterfaces.list(this.taskParameters.resourceGroupName, null, (error, networkInterfaces, request, response) => {
                if (error) {
                    return reject(tl.loc("FailedToFetchNetworkInterfaces", utils.getError(error)));
                }
                this.networkInterfaceDetails = networkInterfaces;
                resolve(networkInterfaces);
            });
        });
    }

    public getPublicIPAddresses(): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.networkClient.publicIPAddresses.list(this.taskParameters.resourceGroupName, null, (error, publicAddresses, request, response) => {
                if (error) {
                    return reject(tl.loc("FailedToFetchPublicAddresses", utils.getError(error)));
                }
                this.publicAddressDetails = publicAddresses;
                resolve(publicAddresses);
            });
        });
    }

    private getDetails(): Promise<any[]> {
        var details = [this.getLoadBalancers(), this.getNetworkInterfaceDetails(), this.getPublicIPAddresses(), this.getVMDetails()];
        return Promise.all(details);
    }

}
