declare module 'shazamio-core' {
  export class DecodedSignature {
    free(): void;
    readonly number_samples: number;
    readonly samplems: number;
    readonly uri: string;
  }
  export function recognizeBytes(bytes: Uint8Array, offset?: number, seconds?: number): DecodedSignature[];
}
