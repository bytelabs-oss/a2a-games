// A game imports these to start and end itself. The running shell fills them in. Each returns {ok, message}.
export interface Outcome {
  ok: boolean;
  message?: string;
}
export interface Controls {
  startGame(): Outcome;
  endGame(): Outcome;
}

let shell: Controls | null = null;

export const connect = (controls: Controls) => { shell = controls; };
const notRunning: Outcome = { ok: false, message: 'No shell is running this game.' };
export const startGame = () => shell?.startGame() ?? notRunning;
export const endGame = () => shell?.endGame() ?? notRunning;
