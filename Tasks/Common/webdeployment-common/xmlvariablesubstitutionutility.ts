import Q = require('q');
import tl = require('vsts-task-lib/task');
import fs = require('fs');
import path = require('path');

var ltx = require("ltx");
var varUtility = require ('./variableutility.js');
var ltxdomutility = require("./ltxdomutility.js");
var fileEncoding = require('./fileencoding.js');

function getReplacableTokenFromTags(xmlNode, variableMap) {
    var parameterSubValue = {};
    for (var childNode of xmlNode.children) {
        if(!varUtility.isObject(childNode)) {
            continue;
        }
        for(var nodeAttribute in childNode.attrs) {
            if (childNode.attrs[nodeAttribute].startsWith('$(ReplacableToken_') && variableMap[childNode.attrs['name']]) {
                var indexOfReplaceToken = '$(ReplacableToken_'.length;
                var lastIndexOf_ = childNode.attrs[nodeAttribute].lastIndexOf('_');
                if(lastIndexOf_ <= indexOfReplaceToken) {
                    tl.debug('Attribute value is in incorrect format ! ' + childNode.attrs[nodeAttribute]);
                    continue;
                }
                parameterSubValue[childNode.attrs[nodeAttribute].substring(indexOfReplaceToken, lastIndexOf_)] = variableMap[childNode.attrs['name']].replace(/"/g, "'");
            }
        }
    }
    return parameterSubValue;
}

function substituteValueinParameterFile(parameterFilePath, parameterSubValue) {

    if(Object.keys(parameterSubValue).length === 0) {
        tl.debug('No substitution variables found for parameters.xml');
        return;  
    }
    var fileBuffer: Buffer = fs.readFileSync(parameterFilePath);
    var fileEncodeType = fileEncoding.detectFileEncoding(parameterFilePath, fileBuffer);
    var webConfigContent: string = fileBuffer.toString(fileEncodeType[0]);
    if(fileEncodeType[1]) {
        webConfigContent = webConfigContent.slice(1);
    }
    var xmlDocument;
    const paramFileReplacableToken = 'PARAM_FILE_REPLACE_TOKEN';
    var paramFileReplacableValues = {};
    try {
        xmlDocument = ltxdomutility.initializeDOM(webConfigContent);
        for(var xmlChildNode of xmlDocument.children) {
            if(!varUtility.isObject(xmlChildNode)) {
                continue;
            }
            if(parameterSubValue[ xmlChildNode.attrs.name ]) {
                var paramFileReplacableTokenName = paramFileReplacableToken + '(' + xmlChildNode.attrs.name + ')';
                xmlChildNode.attrs.defaultValue = paramFileReplacableTokenName;
                tl.debug('Parameters file - Replacing value for name: ' + xmlChildNode.attrs.name + ' with : ' + paramFileReplacableTokenName);
                paramFileReplacableValues[paramFileReplacableTokenName] = parameterSubValue[ xmlChildNode.attrs.name ];
            }
        }
    }
    catch(error) {
        tl.debug("Unable to parse parameter file : " + parameterFilePath + ' Error: ' + error);
        return;
    }
    var domContent = (fileEncodeType[1] ? '\uFEFF' : '') + ltxdomutility.getContentWithHeader(xmlDocument);
    for(var paramFileReplacableValue in paramFileReplacableValues) {
        tl.debug('Parameters file - Replacing value for temp_name: ' + paramFileReplacableValue);
        domContent = domContent.replace(paramFileReplacableValue, paramFileReplacableValues[paramFileReplacableValue]);
    }
    tl.writeFile(parameterFilePath, domContent, fileEncodeType[0]);
    tl.debug("Parameter file " + parameterFilePath + " updated.");
}

export function substituteAppSettingsVariables(folderPath, isFolderBasedDeployment) {
    var configFiles = tl.findMatch(folderPath, "**/*.config");
    var parameterFilePath = path.join(folderPath, 'parameters.xml');
    if(!isFolderBasedDeployment && tl.exist(parameterFilePath)) {
        tl.debug('Detected parameters.xml file - XML variable substitution');
    }
    else {
        parameterFilePath = null;
    }
    var variableMap = varUtility.getVariableMap();
    var tags = ["applicationSettings", "appSettings", "connectionStrings", "configSections"];
    for(var configFile of configFiles) {
        substituteXmlVariables(configFile, tags, variableMap, parameterFilePath);
    }
}

export function substituteXmlVariables(configFile, tags, variableMap, parameterFilePath) {
    if(!tl.exist(configFile)) {
        throw new Error(tl.loc("Configfiledoesntexists", configFile));
    }
    if( !tl.stats(configFile).isFile()) {
        return;
    }
    tl.debug("Initiated variable substitution in config file : " + configFile);
    var fileBuffer: Buffer = fs.readFileSync(configFile);
    var fileEncodeType = fileEncoding.detectFileEncoding(configFile, fileBuffer);
    var webConfigContent: string = fileBuffer.toString(fileEncodeType[0]);
    if(fileEncodeType[1]) {
        webConfigContent = webConfigContent.slice(1);
    }
    var xmlDocument;
    try{
        xmlDocument = ltxdomutility.initializeDOM(webConfigContent);
    } 
    catch(error) {
        tl.debug("Unable to parse file : " + configFile);
        tl.debug(error);
        return;
    }
    var replacableTokenValues = {};
    for(var tag of tags) {
        var nodes = ltxdomutility.getElementsByTagName(tag); 
        if(nodes.length == 0) {
            tl.debug("Unable to find node with tag '" + tag + "' in provided xml file.");
            continue;
        }
        for(var xmlNode of nodes) {
            if(varUtility.isObject(xmlNode)){
                tl.debug("Processing substitution for xml node : " + xmlNode.name);
                try {
                    if(xmlNode.name == "configSections") {
                        updateXmlConfigNodeAttribute(xmlDocument, xmlNode, variableMap, replacableTokenValues);
                    }
                    else if(xmlNode.name == "connectionStrings") {
                        if(parameterFilePath) {
                            var parameterSubValue = getReplacableTokenFromTags(xmlNode, variableMap);
                            substituteValueinParameterFile(parameterFilePath, parameterSubValue);
                        }
                        updateXmlConnectionStringsNodeAttribute(xmlNode, variableMap, replacableTokenValues);
                    }
                    else {
                        updateXmlNodeAttribute(xmlNode, variableMap, replacableTokenValues);
                    }
                } catch (error){
                    tl.debug("Error occurred while processing xml node : " + xmlNode.name);
                    tl.debug(error);
                }
            }  
        }
    }
    var domContent = ( fileEncodeType[1]? '\uFEFF' : '' ) + ltxdomutility.getContentWithHeader(xmlDocument);
    for(var replacableTokenValue in replacableTokenValues) {
        tl.debug('Substituting original value in place of temp_name: ' + replacableTokenValue);
        domContent = domContent.split(replacableTokenValue).join(replacableTokenValues[replacableTokenValue]);
    }
    tl.writeFile(configFile, domContent, fileEncodeType[0]);
    tl.debug("Config file " + configFile + " updated.");
}

function updateXmlConfigNodeAttribute(xmlDocument, xmlNode, variableMap, replacableTokenValues) {
    var sections = ltxdomutility.getChildElementsByTagName(xmlNode, "section");
    for(var section of sections) {
        if(varUtility.isObject(section)) {
            var sectionName = section.attr('name');
            if(!varUtility.isEmpty(sectionName)) {
                var customSectionNodes = ltxdomutility.getElementsByTagName(sectionName);
                if( customSectionNodes.length != 0) {
                    var customNode = customSectionNodes[0];
                    updateXmlNodeAttribute(customNode, variableMap, replacableTokenValues);
                }
            }
        }
    }
}

function updateXmlNodeAttribute(xmlDomNode, variableMap, replacableTokenValues) {

    if (varUtility.isEmpty(xmlDomNode) || !varUtility.isObject(xmlDomNode) || xmlDomNode.name == "#comment") {
        tl.debug("Provided node is empty or a comment.");
        return;
    }
    var xmlDomNodeAttributes = xmlDomNode.attrs;
    const ConfigFileAppSettingsToken = 'CONFIG_FILE_SETTINGS_TOKEN';
    for(var attributeName in xmlDomNodeAttributes) {
        var attributeNameValue = (attributeName === "key") ? xmlDomNodeAttributes[attributeName] : attributeName;
        var attributeName = (attributeName === "key") ? "value" : attributeName;
        if(variableMap[attributeNameValue]) {
            var ConfigFileAppSettingsTokenName = ConfigFileAppSettingsToken + '(' + attributeNameValue + ')';
            tl.debug('Updating value for key=' + attributeNameValue + 'with token_value: ' + ConfigFileAppSettingsTokenName);
            xmlDomNode.attr(attributeName, ConfigFileAppSettingsTokenName);
            replacableTokenValues[ConfigFileAppSettingsTokenName] =  variableMap[attributeNameValue].replace(/"/g, "'");
        }
    }
    var children = xmlDomNode.children;
    for(var childNode of children) {
        if(varUtility.isObject(childNode)) {
            updateXmlNodeAttribute(childNode, variableMap, replacableTokenValues);
        }
    }
}

function updateXmlConnectionStringsNodeAttribute(xmlDomNode, variableMap, replacableTokenValues) {

    const ConfigFileConnStringToken = 'CONFIG_FILE_CONN_STRING_TOKEN';
    if (varUtility.isEmpty(xmlDomNode) || !varUtility.isObject(xmlDomNode) || xmlDomNode.name == "#comment") {
        tl.debug("Provided node is empty or a comment.");
        return;
    }
    var xmlDomNodeAttributes = xmlDomNode.attrs;

    if(xmlDomNodeAttributes.hasOwnProperty("connectionString")) {
        if(xmlDomNodeAttributes.hasOwnProperty("name") && variableMap[xmlDomNodeAttributes.name]) {
            var ConfigFileConnStringTokenName = ConfigFileConnStringToken + '(' + xmlDomNodeAttributes.name + ')';
            tl.debug('Substituting connectionString value for name=' + xmlDomNodeAttributes.name + ' with token_value: ' + ConfigFileConnStringTokenName);
            xmlDomNode.attr("connectionString", ConfigFileConnStringTokenName);
            replacableTokenValues[ConfigFileConnStringTokenName] = variableMap[xmlDomNodeAttributes.name].replace(/"/g, "'");
        }
        else if(variableMap["connectionString"]) {
            var ConfigFileConnStringTokenName = ConfigFileConnStringToken + '(connectionString)';
            tl.debug('Substituting connectionString value for connectionString=' + xmlDomNodeAttributes.name + ' with token_value: ' + ConfigFileConnStringTokenName);
            xmlDomNode.attr("connectionString", ConfigFileConnStringTokenName);
            replacableTokenValues[ConfigFileConnStringTokenName] = variableMap["connectionString"].replace(/"/g, "'");
        }
    }

    var children = xmlDomNode.children;
    for(var childNode of children) {
        if(varUtility.isObject(childNode)) {
            updateXmlConnectionStringsNodeAttribute(childNode, variableMap, replacableTokenValues);
        }
    }
}