// AudioWorklet that forwards mono PCM frames from the microphone to the main thread (in memory only).
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('wingit-pcm-capture', PcmCapture);
