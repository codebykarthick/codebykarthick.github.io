// Loads the library from 
@Library("ci-shared-lib") _

pipeline {
    agent any

    stages {
        stage("Git Clone") {
            steps {
                echo "Building from: ${env.GIT_URL}"
                echo "Branch: ${params.BRANCH}"
                echo "Branch: ${env.GIT_BRANCH}"
                echo "Commit: ${env.GIT_COMMIT}"
            }
        }
    }
}