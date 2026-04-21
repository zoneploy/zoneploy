export type PairingState = {
  paired: boolean;
  cloudUrl?: string;
  instanceId?: string;
  pairedAt?: string;
};

export type PairingRequest = {
  pairingToken: string;
  cloudUrl: string;
  instanceName: string;
};

export type PairingResult = {
  instanceId: string;
  cloudUrl: string;
  pairedAt: string;
};
