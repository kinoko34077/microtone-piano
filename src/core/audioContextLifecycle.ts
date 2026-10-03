export type RuntimeAudioContextState = AudioContextState | 'interrupted';

export function getRuntimeAudioContextState(context: AudioContext): RuntimeAudioContextState {
  return context.state as RuntimeAudioContextState;
}

export async function resumeAudioContextForPlayback(
  context: AudioContext,
): Promise<RuntimeAudioContextState> {
  const initialState = getRuntimeAudioContextState(context);
  if (initialState === 'suspended') {
    await context.resume();
  }

  const state = getRuntimeAudioContextState(context);
  if (state !== 'running') {
    throw new Error(`AudioContext did not enter running state: ${state}`);
  }

  return state;
}
