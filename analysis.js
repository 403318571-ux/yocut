// A lightweight onset estimator for rhythmic music. It uses low-frequency
// transients to find kicks and a broader transient envelope to estimate tempo.
export function analyzeRhythm(buffer) {
  const rate = buffer.sampleRate;
  const length = Math.min(buffer.length, Math.floor(rate * 90));
  const hop = Math.max(1, Math.round(rate / 100));
  const frames = Math.floor(length / hop);
  if (frames < 250) return null;

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const lowEnergy = new Float64Array(frames);
  const fullEnergy = new Float64Array(frames);
  const smoothing = Math.exp(-2 * Math.PI * 155 / rate);
  let low = 0;
  for (let frame = 0; frame < frames; frame++) {
    let bass = 0, broad = 0;
    const begin = frame * hop;
    for (let i = begin; i < begin + hop; i += 2) {
      const sample = (left[i] + right[i]) * .5;
      low = smoothing * low + (1 - smoothing) * sample;
      bass += low * low;
      broad += sample * sample;
    }
    lowEnergy[frame] = Math.sqrt(bass);
    fullEnergy[frame] = Math.sqrt(broad);
  }

  const novelty = (energy) => {
    const result = new Float64Array(frames);
    let sum = 0;
    for (let i = 0; i < frames; i++) {
      const previous = i > 0 ? energy[i - 1] : 0;
      result[i] = Math.max(0, energy[i] - previous * .88);
      sum += result[i];
    }
    return { values: result, mean: sum / frames };
  };
  const bass = novelty(lowEnergy), broad = novelty(fullEnergy);
  const peaks = [];
  const radius = Math.max(12, Math.round(.2 * rate / hop));
  for (let i = 2; i < frames - 2; i++) {
    if (bass.values[i] < bass.mean * 2.1) continue;
    if (bass.values[i] < bass.values[i - 1] || bass.values[i] < bass.values[i + 1]) continue;
    const last = peaks.at(-1);
    if (last && i - last.frame < radius) {
      if (bass.values[i] > last.strength) peaks[peaks.length - 1] = { frame: i, strength: bass.values[i] };
    } else peaks.push({ frame: i, strength: bass.values[i] });
  }
  if (peaks.length < 4) return null;

  const frameSeconds = hop / rate;
  const scorePeriod = (seconds) => {
    const lag = Math.round(seconds / frameSeconds);
    if (lag < 1) return 0;
    let score = 0;
    for (const peak of peaks) {
      for (const multiple of [1, 2]) {
        const target = peak.frame + lag * multiple;
        if (target >= frames) continue;
        let match = 0;
        for (let n = -3; n <= 3; n++) match = Math.max(match, bass.values[target + n] || 0);
        score += Math.min(peak.strength, match) / multiple;
      }
    }
    return score;
  };
  const tempoScores = [];
  for (let bpm = 70; bpm <= 180; bpm++) {
    const seconds = 60 / bpm;
    let score = scorePeriod(seconds);
    // Broadband attacks help disambiguate half-time kick patterns.
    const lag = Math.round(seconds / frameSeconds);
    for (const peak of peaks) {
      const target = peak.frame + lag;
      if (target >= frames) continue;
      let match = 0;
      for (let n = -3; n <= 3; n++) match = Math.max(match, broad.values[target + n] || 0);
      score += Math.min(peak.strength, match) * .12;
    }
    tempoScores.push({ bpm, score });
  }
  tempoScores.sort((a, b) => b.score - a.score);
  const best = tempoScores[0];
  if (!best || best.score <= 0) return null;

  const intervals = peaks.slice(1).map((peak,i)=>(peak.frame-peaks[i].frame)*frameSeconds).filter(t=>t>.29&&t<1.4).sort((a,b)=>a-b);
  let estimatedBpm=best.bpm;
  if(intervals.length>=4){
    let interval=intervals[Math.floor(intervals.length/2)];
    while(60/interval<70)interval/=2;
    while(60/interval>180)interval*=2;
    const refined=Math.round(60/interval);
    if(Math.abs(refined-best.bpm)<=8)estimatedBpm=refined;
  }

  const periodFrames = (60 / estimatedBpm) / frameSeconds;
  const firstStrong = peaks.find((peak) => {
    if (peak.frame * frameSeconds > 12) return false;
    let matches = 0;
    for (let multiple = 1; multiple <= 4; multiple++) {
      const target = peak.frame + Math.round(periodFrames * multiple);
      if (target >= frames) break;
      if (peaks.some(p => Math.abs(p.frame - target) <= 9)) matches++;
    }
    return matches >= 2;
  }) || peaks.find(p => p.frame * frameSeconds < 12);
  if (!firstStrong) return null;
  return {
    bpm: estimatedBpm,
    kickSeconds: firstStrong.frame * frameSeconds,
    detectedKicks: peaks.map(p => p.frame * frameSeconds),
    confidence: Math.min(1, best.score / Math.max(1, peaks.length * bass.mean * 4))
  };
}
