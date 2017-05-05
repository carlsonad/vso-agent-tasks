/// <reference path="../../../../definitions/vsts-task-lib.d.ts" />
import tl = require('vsts-task-lib/task');
import { ToolRunner } from 'vsts-task-lib/toolrunner';

import { SonarQubeEndpoint } from './endpoint';
import { VstsServerUtils } from './vsts-server-utils';

export class SonarQubeParameterHelper {
    /**
     * Applies parameters for SonarQube features enabled by the user.
     * @param toolRunner     ToolRunner to add parameters to
     * @returns {ToolRunner} ToolRunner with parameters added
     */
    public static applySonarQubeParameters(toolRunner: ToolRunner): ToolRunner {
        toolRunner = SonarQubeParameterHelper.applySonarQubeConnectionParams(toolRunner);
        toolRunner = SonarQubeParameterHelper.applySonarQubeAnalysisParams(toolRunner);
        toolRunner = SonarQubeParameterHelper.applySonarQubeIssuesModeInPrBuild(toolRunner);
        return toolRunner;
    }

    /**
     * Applies required parameters for connecting a Java-based plugin (Maven, Gradle) to SonarQube.
     * @param toolRunner     ToolRunner to add parameters to
     * @returns {ToolRunner} ToolRunner with parameters added
     */
    private static applySonarQubeConnectionParams(toolRunner: ToolRunner): ToolRunner {
        let sqEndpoint: SonarQubeEndpoint = SonarQubeEndpoint.getTaskSonarQubeEndpoint();
        toolRunner.arg('-Dsonar.host.url=' + sqEndpoint.Url);
        toolRunner.arg('-Dsonar.login=' + sqEndpoint.Username);
        toolRunner.arg('-Dsonar.password=' + sqEndpoint.Password);

        // sqDbUrl, sqDbUsername and sqDbPassword are required if the SonarQube version is less than 5.2.
        let sqDbUrl: string = tl.getInput('sqDbUrl', false);
        let sqDbUsername: string = tl.getInput('sqDbUsername', false);
        let sqDbPassword: string = tl.getInput('sqDbPassword', false);

        if (sqDbUrl) {
            toolRunner.arg('-Dsonar.jdbc.url=' + sqDbUrl);
        }
        if (sqDbUsername) {
            toolRunner.arg('-Dsonar.jdbc.username=' + sqDbUsername);
        }
        if (sqDbPassword) {
            toolRunner.arg('-Dsonar.jdbc.password=' + sqDbPassword);
        }

        return toolRunner;
    }

    /**
     * Applies parameters for manually specifying the project name, key and version to SonarQube.
     * This will override any settings that may have been specified manually by the user.
     * @param toolRunner     ToolRunner to add parameters to
     * @returns {ToolRunner} ToolRunner with parameters added
     */
    private static applySonarQubeAnalysisParams(toolRunner: ToolRunner): ToolRunner {
        let projectName: string = tl.getInput('sqProjectName', false);
        let projectKey: string = tl.getInput('sqProjectKey', false);
        let projectVersion: string = tl.getInput('sqProjectVersion', false);

        if (projectName) {
            toolRunner.arg('-Dsonar.projectName=' + projectName);
        }
        if (projectKey) {
            toolRunner.arg('-Dsonar.projectKey=' + projectKey);
        }
        if (projectVersion) {
            toolRunner.arg('-Dsonar.projectVersion=' + projectVersion);
        }

        return toolRunner;
    }

    /**
     * Applies parameters that will run SQ analysis in issues mode if this is a pull request build
     * @param toolRunner     ToolRunner to add parameters to
     * @returns {ToolRunner} ToolRunner with parameters added
     */
    private static applySonarQubeIssuesModeInPrBuild(toolrunner: ToolRunner): ToolRunner {
        if (VstsServerUtils.isPrBuild()) {
            console.log(tl.loc('sqAnalysis_IncrementalMode'));

            toolrunner.arg('-Dsonar.analysis.mode=issues');
            toolrunner.arg('-Dsonar.report.export.path=sonar-report.json');
        } else {
            tl.debug('Running a full SonarQube analysis');
        }

        return toolrunner;
    }
}
