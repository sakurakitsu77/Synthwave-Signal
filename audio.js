/* =========================
   Synthwave Signal Audio
   - procedural synth pads, bass, arp, and soft drums
========================= */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.filter = null;
    this.delay = null;
    this.tempo = 92;
    this.step = 0;
    this.nextStepTime = 0;
    this.isRunning = false;
    this.palette = null;
    this.scheduleAhead = 0.12;
    this.noiseBuffer = null;
    this.startedAt = 0;
  }

  async start(config) {
    if (this.isRunning) {
      this.setConfig(config);
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1400;
    this.filter.Q.value = 0.5;

    this.delay = this.ctx.createDelay(0.6);
    this.delay.delayTime.value = 0.19;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.22;

    const wet = this.ctx.createGain();
    wet.gain.value = 0.2;

    const dry = this.ctx.createGain();
    dry.gain.value = 0.95;

    this.filter.connect(dry);
    this.filter.connect(this.delay);
    this.delay.connect(feedback);
    feedback.connect(this.delay);
    this.delay.connect(wet);

    dry.connect(this.master);
    wet.connect(this.master);
    this.master.connect(this.ctx.destination);

    this.noiseBuffer = this._buildNoise();

    this.setConfig(config);
    this.isRunning = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.startedAt = this.ctx.currentTime;
  }

  setConfig(config) {
    this.tempo = config.tempo || 92;
    this.palette = config.palette || {};
    if (this.filter) {
      this.filter.frequency.setTargetAtTime(config.filter || 1400, this.ctx.currentTime, 0.04);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
    }
    this.ctx = null;
  }

  update(track, onBeat) {
    if (!this.isRunning || !this.ctx) return;

    const beatDur = 60 / this.tempo;
    const now = this.ctx.currentTime;

    while (this.nextStepTime < now + this.scheduleAhead) {
      this._scheduleStep(this.step, this.nextStepTime, track, onBeat);
      this.nextStepTime += beatDur / 2; // 8th notes
      this.step += 1;
    }
  }

  _scheduleStep(step, when, track, onBeat) {
    const beat = step / 2;
    const bar = Math.floor(beat / 4);
    const beatInBar = beat % 4;

    // Kick / snare / hat pattern, kept soft.
    if (beatInBar === 0 || beatInBar === 2) this._kick(when, 1 - (beatInBar * 0.12));
    if (beatInBar === 1 || beatInBar === 3) this._snare(when, 0.22);
    this._hat(when, 0.085 + (step % 4 === 0 ? 0.02 : 0));

    // Bass line
    const bassPattern = track.bassPattern || [0, 0, 3, 0, 0, 5, 3, 0];
    const bassIndex = step % bassPattern.length;
    if (step % 2 === 0) {
      const note = bassPattern[bassIndex];
      this._bass(when + 0.01, track.root * Math.pow(2, note / 12), 0.18);
    }

    // Pad chord on bar changes
    if (beatInBar === 0) {
      const chord = track.chords[bar % track.chords.length];
      this._pad(when + 0.01, chord, 0.09);
    }

    // Arp flourish
    if (step % 4 === 1 || step % 8 === 6) {
      const arpNote = track.arp[step % track.arp.length];
      this._arp(when + 0.01, track.root * Math.pow(2, arpNote / 12), 0.05);
    }

    // Listener callback for gameplay timing.
    if (onBeat && step % 2 === 0) onBeat({ step, beat, bar, beatInBar, when });
  }

  note(freq, type = 'triangle', gain = 0.10, dur = 0.28, pan = 0) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0.0001;
    osc.connect(g);
    if (p) { g.connect(p); p.pan.value = pan; p.connect(this.filter); }
    else g.connect(this.filter);

    const t = this.ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _bass(when, freq, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.995, when + 0.12);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    osc.connect(g);
    g.connect(this.filter);
    osc.start(when);
    osc.stop(when + 0.24);
  }

  _pad(when, chord, gain) {
    chord.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq / (idx === 2 ? 2 : 1);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain * (idx === 0 ? 0.4 : 0.18), when + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 1.3);
      osc.connect(g);
      g.connect(this.filter);
      osc.start(when);
      osc.stop(when + 1.45);
    });
  }

  _arp(when, freq, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
    osc.connect(g);
    if (p) {
      p.pan.value = (Math.random() * 0.5) - 0.25;
      g.connect(p);
      p.connect(this.filter);
    } else {
      g.connect(this.filter);
    }
    osc.start(when);
    osc.stop(when + 0.14);
  }

  _kick(when, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, when);
    osc.frequency.exponentialRampToValueAtTime(48, when + 0.09);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    osc.connect(g);
    g.connect(this.filter);
    osc.start(when);
    osc.stop(when + 0.18);
  }

  _snare(when, gain) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);

    noise.connect(bp);
    bp.connect(g);
    g.connect(this.filter);
    noise.start(when);
    noise.stop(when + 0.14);
  }

  _hat(when, gain) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);

    noise.connect(hp);
    hp.connect(g);
    g.connect(this.filter);
    noise.start(when);
    noise.stop(when + 0.06);
  }

  _buildNoise() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2) - 1;
    return buffer;
  }
}

window.AudioEngine = AudioEngine;
