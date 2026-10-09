// User-facing error copy. Each error says what happened and how to recover.

const COPY = {
  denied: { title: 'Microphone is blocked', body: 'Allow microphone access for this site in your browser\'s address bar, then tap the mic again. Or type your answer below.' },
  'no-mic': { title: 'No microphone found', body: 'Plug in or enable a microphone and tap the mic again. You can also type your answer below.' },
  busy: { title: 'Microphone is busy', body: 'Another app may be using it. Close that app and try again, or type your answer below.' },
  insecure: { title: 'Microphone needs a secure page', body: 'Open WingIt over https:// (or localhost) to use the mic. Typing works everywhere.' },
  unsupported: { title: 'This browser can\'t record here', body: 'Try a recent Chrome, Edge, Firefox or Safari. You can type your answer below.' },
  silent: { title: 'We didn\'t hear anything', body: 'Check that the right microphone is selected and speak a little closer, then try again. Or type your answer.' },
  'empty-transcript': { title: 'Nothing came through', body: 'The transcription came back empty. Try again a little louder, or type your answer below.' },
  'transcribe-failed': { title: 'Transcription failed', body: 'The local speech model hit a problem. Try again, pick the smaller speech model in Settings, or type your answer.' },
  'transcribe-download': { title: 'Speech model didn\'t download', body: 'Check your connection and try again. After the first download it works offline.' },
  empty: { title: 'Add an answer first', body: 'Say or type something. A single sentence is plenty.' },
  'too-long': { title: 'That answer is very long', body: 'Answers are capped at 2,000 characters. Trim it a little and submit again.' },
  webgpu: { title: 'Your browser can\'t run the coach', body: 'The AI coach needs WebGPU: use a recent Chrome or Edge on desktop, Chrome on Android, or Safari 26+. You can still play scenarios and practise out loud.' },
  memory: { title: 'Not enough GPU memory', body: 'Switch to the Lite coach model in Settings, close other heavy tabs, and try again.' },
  download: { title: 'Coach model didn\'t download', body: 'Check your connection and storage space, then try again. Downloads resume from the browser cache.' },
  model: { title: 'The coach couldn\'t start', body: 'Reload the page and try again, or switch to a smaller coach model in Settings.' },
  timeout: { title: 'The coach took too long', body: 'Your answer is still here. Try again, or switch to the Lite coach model if this keeps happening.' },
  'invalid-output': { title: 'The coach got tongue-tied', body: 'Its feedback didn\'t come back in a usable shape. Your answer is still here; try again.' },
};

export function describeError(code, detail) {
  const c = COPY[code] ?? { title: 'Something went wrong', body: 'Try again. Your answer is still here.' };
  return { code, title: c.title, body: c.body, detail: detail ?? null };
}
