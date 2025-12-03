// --- 設定 ---
const stepCount = 16;
const trackCount = 5; 
let isPlaying = false;
let currentStep = 0;
let tempo = 120;
let nextNoteTime = 0.0;
let timerID = null;
const lookahead = 25.0;
const scheduleAheadTime = 0.1;

// ステート
let gridState = Array(trackCount).fill(null).map(() => Array(stepCount).fill(false));
let currentKit = 'standard'; 
const kitNames = ['standard', '8bit', 'soft'];
let kitIndex = 0; 
let isMuted = Array(trackCount).fill(false); 

// Web Audio API
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// マスターボリュームノード
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.5; 
masterGain.connect(audioCtx.destination);

// トラックごとのゲインノード
const trackGainNodes = []; 

// --- DOM要素 ---
const gridEl = document.getElementById('grid');
const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const tempoInput = document.getElementById('tempo-input');
const volInput = document.getElementById('master-volume');
const clearBtn = document.getElementById('clear-btn');
const kitPrevBtn = document.getElementById('kit-prev');
const kitNextBtn = document.getElementById('kit-next');
const kitDisplay = document.getElementById('kit-display');

// --- 初期化 ---
function init() {
  createGrid();

  // トラックゲインノードを作成し、マスターゲインに接続
  for (let i = 0; i < trackCount; i++) {
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.0; 
    gainNode.connect(masterGain); 
    trackGainNodes.push(gainNode);
  }
  
  // イベントリスナー
  playBtn.addEventListener('click', togglePlay);
  stopBtn.addEventListener('click', stopSequence);
  clearBtn.addEventListener('click', exportJson); 
  
  tempoInput.addEventListener('change', (e) => {
    let val = parseInt(e.target.value);
    if(val < 30) val = 30;
    if(val > 300) val = 300;
    tempo = val;
  });

  volInput.addEventListener('input', (e) => {
    masterGain.gain.value = parseFloat(e.target.value);
  });
  
  // Kit選択ボタン
  kitPrevBtn.addEventListener('click', () => changeKit(-1));
  kitNextBtn.addEventListener('click', () => changeKit(1));
  updateKitDisplay(); 

  // ミュートボタン
  document.querySelectorAll('.mute-btn').forEach(btn => {
    btn.addEventListener('click', toggleMute);
  });
}

function createGrid() {
  gridEl.innerHTML = '';
  for (let track = 0; track < trackCount; track++) {
    for (let step = 0; step < stepCount; step++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.track = track;
      cell.dataset.step = step;
      
      cell.addEventListener('click', () => {
        gridState[track][step] = !gridState[track][step];
        cell.classList.toggle('active');
        
        if (gridState[track][step] && !isPlaying) {
             playSound(track, audioCtx.currentTime);
        }
      });
      
      gridEl.appendChild(cell);
    }
  }
}

function togglePlay() {
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (isPlaying) {
    isPlaying = false;
    playBtn.textContent = '⏸ Pause'; // Play/Pauseの表示を切り替え
    playBtn.classList.remove('playing');
    window.clearTimeout(timerID);
  } else {
    isPlaying = true;
    playBtn.textContent = '▶ Playing'; // 再生中はPlayingと表示
    playBtn.classList.add('playing');
    nextNoteTime = audioCtx.currentTime;
    scheduler();
  }
}

function stopSequence() {
  isPlaying = false;
  window.clearTimeout(timerID);
  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('playing');
  currentStep = 0;
  document.querySelectorAll('.cell.playing').forEach(c => c.classList.remove('playing'));
}

function scheduler() {
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    scheduleNote(currentStep, nextNoteTime);
    nextNote();
  }
  if (isPlaying) {
    timerID = window.setTimeout(scheduler, lookahead);
  }
}

function nextNote() {
  const secondsPerBeat = 60.0 / tempo;
  const secondsPer16th = secondsPerBeat / 4; 
  
  nextNoteTime += secondsPer16th;
  
  currentStep++;
  if (currentStep === stepCount) {
    currentStep = 0;
  }
}

function scheduleNote(stepNumber, time) {
  requestAnimationFrame(() => drawPlayhead(stepNumber));
  
  for (let track = 0; track < trackCount; track++) {
    if (gridState[track][stepNumber]) {
      playSound(track, time);
    }
  }
}

function drawPlayhead(stepNumber) {
  const cells = document.querySelectorAll('.cell');
  document.querySelectorAll('.cell.playing').forEach(c => c.classList.remove('playing'));
  
  for (let track = 0; track < trackCount; track++) {
    const index = (track * stepCount) + stepNumber;
    if (cells[index]) cells[index].classList.add('playing');
  }
}


// --- サウンドエンジン ---
function playSound(track, time) {
  if (isMuted[track]) return; 
  
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  // 接続: オシレーター -> ゲイン -> トラックゲイン -> マスターゲイン -> Destination
  osc.connect(gainNode);
  gainNode.connect(trackGainNodes[track]); 

  const kit = kits[currentKit] || kits['standard'];
  const soundParams = kit[track];

  osc.type = soundParams.type;
  
  if (soundParams.freqMove) {
    osc.frequency.setValueAtTime(soundParams.freqStart, time);
    osc.frequency.exponentialRampToValueAtTime(soundParams.freqEnd, time + soundParams.freqDur);
  } else if (soundParams.randomPitch) {
    const scale = [261.63, 311.13, 392.00, 466.16, 523.25];
    const rnd = scale[Math.floor(Math.random() * scale.length)];
    osc.frequency.setValueAtTime(rnd, time);
  } else {
    osc.frequency.setValueAtTime(soundParams.freq, time);
  }

  gainNode.gain.setValueAtTime(soundParams.vol, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + soundParams.decay);

  osc.start(time);
  osc.stop(time + soundParams.decay);
}

// --- ミュート切り替え機能 ---
function toggleMute(e) {
    const trackIndex = parseInt(e.target.dataset.track);
    const btn = e.target;
    
    isMuted[trackIndex] = !isMuted[trackIndex];
    
    if (isMuted[trackIndex]) {
        trackGainNodes[trackIndex].gain.value = 0.0;
        btn.classList.add('muted');
    } else {
        trackGainNodes[trackIndex].gain.value = 1.0;
        btn.classList.remove('muted');
    }
}

// --- Kit選択機能 ---
function changeKit(direction) {
    kitIndex = kitIndex + direction;

    if (kitIndex < 0) {
        kitIndex = kitNames.length - 1;
    } else if (kitIndex >= kitNames.length) {
        kitIndex = 0;
    }

    currentKit = kitNames[kitIndex];
    updateKitDisplay();
}

function updateKitDisplay() {
    let displayName = currentKit.charAt(0).toUpperCase() + currentKit.slice(1);
    
    if (currentKit === '8bit') {
        displayName = '8-Bit Chip';
    } else if (currentKit === 'soft') {
        displayName = 'Soft Electric';
    }
    
    kitDisplay.textContent = displayName;
}


// --- 音色定義データ ---
const kits = {
  'standard': [
    { type: 'triangle', freq: 6000, vol: 0.1, decay: 0.05 }, 
    { type: 'square', freq: 250, vol: 0.2, decay: 0.1 },     
    { type: 'sine', freqMove: true, freqStart: 150, freqEnd: 0.01, freqDur: 0.5, vol: 0.8, decay: 0.5 }, 
    { type: 'sawtooth', freq: 65.41, vol: 0.4, decay: 0.3 }, 
    { type: 'sine', randomPitch: true, vol: 0.3, decay: 0.3 } 
  ],
  '8bit': [
    { type: 'square', freq: 1200, vol: 0.1, decay: 0.05 },   
    { type: 'sawtooth', freqMove: true, freqStart: 400, freqEnd: 100, freqDur: 0.1, vol: 0.2, decay: 0.1 }, 
    { type: 'square', freqMove: true, freqStart: 100, freqEnd: 10, freqDur: 0.2, vol: 0.5, decay: 0.2 }, 
    { type: 'square', freq: 55, vol: 0.4, decay: 0.4 },      
    { type: 'square', randomPitch: true, vol: 0.2, decay: 0.4 } 
  ],
  'soft': [
    { type: 'sine', freq: 4000, vol: 0.05, decay: 0.05 },    
    { type: 'triangle', freq: 200, vol: 0.1, decay: 0.1 },   
    { type: 'sine', freqMove: true, freqStart: 100, freqEnd: 30, freqDur: 0.3, vol: 0.6, decay: 0.3 }, 
    { type: 'sine', freq: 65.41, vol: 0.5, decay: 0.6 },     
    { type: 'triangle', randomPitch: true, vol: 0.2, decay: 0.5 } 
  ]
};

function exportJson() {
    const exportData = {
        meta: {
            app: "Web Step Sequencer",
            version: "4.1",
            exportDate: new Date().toISOString(),
            tempo: tempo,
            kit: currentKit,
            stepCount: stepCount,
            trackCount: trackCount,
            tracks: ["Hi-Hat", "Snare", "Kick", "Bass", "Synth"]
        },
        pattern: gridState 
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `Sequencer_${dateStr}_${tempo}bpm.json`;
    
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('JSONパターンデータのエクスポートが完了しました！');
}

// 開始
init();

// ここに追加
document.getElementById('tempo-inc').addEventListener('click', () => {
  const newVal = Math.min(300, tempo + 1);
  tempo = newVal;
  tempoInput.value = newVal;
});

document.getElementById('tempo-dec').addEventListener('click', () => {
  const newVal = Math.max(30, tempo - 1);
  tempo = newVal;
  tempoInput.value = newVal;
});

// 202512032323
// 取得（既存の tempoInput はあなたのコードにあります）
const incBtn = document.getElementById('tempo-inc');
const decBtn = document.getElementById('tempo-dec');

const TEMPO_MIN = 60, TEMPO_MAX = 240;
function setTempo(v, syncInput = true) {
  if (!Number.isFinite(v)) return;
  const nv = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(v)));
  tempo = nv;                               // ← 元コードの tempo を更新（nextNote が参照）
  if (syncInput) document.getElementById('tempo-input').value = nv;
}
function nudgeTempo(d) { setTempo(tempo + d); }

// ★ 堅牢版：押しっぱなしリピート（pointer capture 不使用）
function addHoldRepeatSafe(btn, delta) {
  if (!btn) return;
  let timer = null, delay = 400, running = false;

  const step = () => {
    nudgeTempo(delta);
    delay = Math.max(60, delay - 40);    // だんだん速く
    timer = setTimeout(step, delay);
  };

  const start = (e) => {
    e.preventDefault();
    if (running) return;
    running = true;
    nudgeTempo(delta);     // 最初の1回
    delay = 400;
    timer = setTimeout(step, delay);

    // ボタン外で指を離しても止める（windowで捕捉）
    const stopOnce = () => { stop(); window.removeEventListener('pointerup', stopOnce, true); };
    window.addEventListener('pointerup', stopOnce, true);
    document.addEventListener('visibilitychange', stopOnHide, { once: true });
    window.addEventListener('blur', stop, { once: true });
  };

  const stop = () => {
    if (!running) return;
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const stopOnHide = () => { if (document.hidden) stop(); };

  btn.addEventListener('pointerdown', start);
  // クリック単発も残す
  btn.addEventListener('click', (e) => { e.preventDefault(); nudgeTempo(delta); });
}

// 有効化
addHoldRepeatSafe(incBtn, +1);
addHoldRepeatSafe(decBtn, -1);

// 入力欄の補助（既存と併用OK）
const tempoInputEl = document.getElementById('tempo-input');
if (tempoInputEl) {
  tempoInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp')   { e.preventDefault(); nudgeTempo(+1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); nudgeTempo(-1); }
    if (e.key === 'PageUp')    { e.preventDefault(); nudgeTempo(+5); }
    if (e.key === 'PageDown')  { e.preventDefault(); nudgeTempo(-5); }
  });
  tempoInputEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudgeTempo(e.deltaY > 0 ? -1 : +1);
  }, { passive: false });
}