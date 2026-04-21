export type PairingState = {
  paired: boolean;
  cloudUrl?: string;
  instanceId?: string;
  pairedAt?: string;
  pairingTokenSet: boolean;
  agentTokenSet: boolean;
  commandPollIntervalSeconds: number;
};

export type PairingRequest = {
  pairingToken: string;
  cloudUrl: string;
  instanceName?: string;
};

export type PairingResult = {
  instanceId: string;
  cloudUrl: string;
  pairedAt: string;
  agentTokenSet: boolean;
  restartRequired: boolean;
};
