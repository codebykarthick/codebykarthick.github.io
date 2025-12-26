// Loads the library from https://github.com/codebykarthick/jenkins-shared-libs
@Library("ci-shared-lib") _

pipeline {
    agent any

    stages {
        // Clone the repo
        stage("Git Clone") {
            gitClone(
                url: env.GIT_URL,
                branch: params.BRANCH
            )
        }

        // Build once linting and running tests if needed
        // to see any errors
        stage("Jekyll test build") {
            buildJekyll()
        }

        // Build the final docker image
        stage("Build Docker Image") {
            dockerBuild(
                imageName: 'jekyll-github-pages'
            )
        }

        // Deploy the final docker image
        stage("Deploy Docker Image") {
            dockerDeploy(
                imageName: 'jekyll-github-pages:latest',
                containerName: 'jekyll-github-pages',
                ports: ['4000:4000']
            )
        }
    }
}