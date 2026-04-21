import {
  createPairingState,
  pairAgentWithCloud,
  unpairAgentFromCloud,
} from "@zoneploy/runtime";
import type { PairingRequest, PairingResult, PairingState } from "@zoneploy/types";
import { agentVersion } from "./version.js";

export const getPairingState = (): PairingState => {
  return createPairingState();
};

export const runPairing = async (request: PairingRequest): Promise<PairingResult> => {
  return pairAgentWithCloud(request, agentVersion);
};

export const runUnpairing = async (): Promise<PairingState> => {
  return unpairAgentFromCloud();
};
