import type { servers } from '../db/schema.js'
import { workerClient } from './worker-client.js'

type Server = typeof servers.$inferSelect

export function getContainerAgentClient(server: Server) {
  void server
  return {
    deploy: workerClient.deploy,
    buildAndDeploy: workerClient.buildAndDeploy,
    stopContainer: workerClient.stopContainer,
    startContainer: workerClient.startContainer,
    pauseContainer: workerClient.pauseContainer,
    restartContainer: workerClient.restartContainer,
    syncContainerRoutes: workerClient.syncContainerRoutes,
    clearContainerRoutes: workerClient.clearContainerRoutes,
    inspectContainer: workerClient.inspectContainer,
  }
}

export function getStackAgentClient(server: Server) {
  void server
  return {
    deployStack: workerClient.deployStack,
    buildAndDeployStack: workerClient.buildAndDeployStack,
    listStackServices: workerClient.listStackServices,
    startStack: workerClient.startStack,
    stopStack: workerClient.stopStack,
    purgeStackRuntime: workerClient.purgeStackRuntime,
    restartStack: workerClient.restartStack,
    syncStackRoutes: workerClient.syncStackRoutes,
    clearStackRoutes: workerClient.clearStackRoutes,
    startStackService: workerClient.startStackService,
    stopStackService: workerClient.stopStackService,
    restartStackService: workerClient.restartStackService,
    inspectStackService: workerClient.inspectStackService,
  }
}
