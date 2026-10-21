import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInterviewStore } from '../../store/interviewStore';
import { interviewApi } from '../../api/interview';
import { formatDuration } from '../../lib/formatters';
import { INTERVIEW_PHASES } from '../../lib/constants';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import {
  Volume2,
  VolumeX,
  PhoneOff,
  Award,
  Clock,
  Zap,
  Activity,
  FileText,
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Keyboard,
  Sparkles,
} from '../../components/icons';
import toast from 'react-hot-toast';
import { getFriendlyErrorMessage } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { CandidateWebcam } from '../../components/interview/CandidateWebcam';

// Barge-in VAD thresholds: mean energy (0-255) in the speech band, held for this long
const BARGE_IN_ENERGY = 70;
const BARGE_IN_HOLD_MS = 350;

export const InterviewSession: React.FC = () => {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const {
    session,
    setFullSession,
    isAISpeaking,
    isStudentSpeaking,
    isMicMuted,
    partialTranscript,
    elapsedSeconds,
    setConnectionStatus,
    setAvatarState,
    setIsAISpeaking,
    setIsStudentSpeaking,
    setMicMuted,
    setMicPermission,
    addTranscriptMessage,
    updateLastTranscriptMessage,
    setPartialTranscript,
    setPhase,
    incrementTimer
  } = useInterviewStore();

  const [showEndModal, setShowEndModal] = useState(false);
  const [inputTextFallback, setInputTextFallback] = useState('');
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isStreamingText, setIsStreamingText] = useState(false);
  const [lastTurnLatencyMs, setLastTurnLatencyMs] = useState<number | null>(null);

  // 100% Voice Interview Auto-Advance & Live Speech Subtitles
  const isInterviewStartedRef = useRef(true);

  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const isAudioUnlockedRef = useRef(false);

  const [liveStudentSpeech, setLiveStudentSpeech] = useState('');
  const liveStudentSpeechRef = useRef('');

  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const silenceTimerRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);

  const [showKeyboardFallback, setShowKeyboardFallback] = useState(false);

  // Real-time Audio Spectrum Bars (11 frequency bands)
  const [audioFreqBars, setAudioFreqBars] = useState<number[]>([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);

  // Studio Neural Voice Selection & Audio Element Ref
  const [selectedVoice, setSelectedVoice] = useState<string>('christopher');
  const selectedVoiceRef = useRef<string>('christopher');
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Web Audio API refs for 60fps real-time frequency visualization
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Audio loop & echo prevention refs
  const isMicMutedRef = useRef(isMicMuted);
  const isAISpeakingRef = useRef(false);
  const isProcessingTurnRef = useRef(false);
  const lastAISpeakEndRef = useRef(0);
  // Observable turn signals sent with each answer (spec §14.3) and barge-in state (spec §14.2)
  const answerSourceRef = useRef<'voice' | 'text'>('text');
  const firstSpeechAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const questionReadyAtRef = useRef(0);
  const interruptionCountRef = useRef(0);
  const bargeInSinceRef = useRef(0);
  const stopAISpeechRef = useRef<(() => void) | null>(null);
  const lastAIQuestionRef = useRef('');
  const isAudioMutedRef = useRef(isAudioMuted);

  // Sync ref values
  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

  useEffect(() => {
    isProcessingTurnRef.current = isProcessingTurn;
  }, [isProcessingTurn]);

  useEffect(() => {
    isAudioMutedRef.current = isAudioMuted;
    if (isAudioMuted) {
      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause();
          activeAudioRef.current.currentTime = 0;
        } catch { /* best-effort; safe to ignore */ }
        activeAudioRef.current = null;
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    }
  }, [isAudioMuted]);

  // Cleanup active audio element and utterance on unmount
  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause();
          activeAudioRef.current.currentTime = 0;
        } catch { /* best-effort; safe to ignore */ }
        activeAudioRef.current = null;
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Global user-gesture audio unlocker: unblocks browser Web Speech API & AudioContext on first click or keypress
  useEffect(() => {
    const unlockAudio = () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
      setIsAudioUnlocked(true);
      isAudioUnlockedRef.current = true;
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  // Pre-load and listen for available system speech synthesis voices in Chrome/Edge
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      const loadVoices = () => {
        if (synthRef.current) {
          synthRef.current.getVoices();
        }
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, []);

  // Real-time 60fps Web Audio Spectrum Visualizer
  useEffect(() => {
    const updateSpectrum = () => {
      if (analyserRef.current && !isMicMutedRef.current && !isAISpeakingRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Sample 11 distinct frequency bands across human speech range (100Hz - 3400Hz)
        const step = Math.floor(bufferLength / 16);
        const newBars: number[] = [];
        for (let i = 0; i < 11; i++) {
          const val = dataArray[(i + 1) * step] || 0;
          // Scale from 0-255 to 4px - 36px height
          const scaledHeight = Math.max(4, Math.min(36, Math.round((val / 255) * 36)));
          newBars.push(scaledHeight);
        }
        setAudioFreqBars(newBars);
      } else if (isAISpeakingRef.current) {
        // Barge-in: sustained candidate voice energy while the interviewer talks stops TTS
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const voiceBand = data.slice(2, 12);
          const energy = voiceBand.reduce((a, b) => a + b, 0) / voiceBand.length;
          if (energy > BARGE_IN_ENERGY) {
            if (!bargeInSinceRef.current) bargeInSinceRef.current = Date.now();
            if (Date.now() - bargeInSinceRef.current > BARGE_IN_HOLD_MS && stopAISpeechRef.current) {
              bargeInSinceRef.current = 0;
              interruptionCountRef.current += 1;
              stopAISpeechRef.current();
            }
          } else {
            bargeInSinceRef.current = 0;
          }
        }
        // Dynamic harmonic wave oscillation during AI speech
        const time = Date.now() * 0.008;
        const aiWave = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map((offset) => {
          const wave = Math.sin(time + offset * 0.7);
          return Math.max(6, Math.round(18 + wave * 14));
        });
        setAudioFreqBars(aiWave);
      } else {
        // Idle resting state
        setAudioFreqBars([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
      }

      animFrameIdRef.current = requestAnimationFrame(updateSpectrum);
    };

    animFrameIdRef.current = requestAnimationFrame(updateSpectrum);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, []);

  // Auto-init session or fetch stored session from backend if refreshed on URL
  useEffect(() => {
    if (!session || session.sessionId !== sessionId) {
      interviewApi.getSession(sessionId)
        .then((backendSession) => {
          if (backendSession.status === 'completed') {
            navigate(`/report/${backendSession.sessionId}`, { replace: true });
            return;
          }
          setFullSession(backendSession);
          isInterviewStartedRef.current = true;
        })
        .catch((err) => {
          toast.error(getFriendlyErrorMessage(err));
          navigate('/interview', { replace: true });
        });
    } else {
      isInterviewStartedRef.current = true;
      if (session.transcript.length === 0) {
        const candidateName = user?.name || 'there';
        const topProject = session.resumeContext?.hotspots?.[0]?.title;
        const initialGreeting =
          session.greeting ||
          (topProject
            ? `Hello ${candidateName}, welcome! I've been reviewing your resume and see your project on "${topProject}". To kick things off, can you walk me through how you architected that system and how you solved the core technical challenges in it?`
            : `Hello ${candidateName}, welcome! To kick things off, can you walk me through a recent project you built and the hardest technical problem you solved in it?`);
        addTranscriptMessage({
          speaker: 'ai',
          text: initialGreeting
        });
        lastAIQuestionRef.current = initialGreeting;
      }
    }
  }, [session, sessionId, setFullSession, addTranscriptMessage, user, navigate]);

  // Auto-scroll transcript to bottom in real-time (isolated to transcript panel)
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [session?.transcript, partialTranscript, liveStudentSpeech]);

  // Session Timer Interval (Real-time seconds counter)
  useEffect(() => {
    const timer = setInterval(() => {
      incrementTimer();
    }, 1000);
    return () => clearInterval(timer);
  }, [incrementTimer]);

  // Studio Neural TTS with HTML5 Audio and Web Speech Fallback
  const speakAI = useCallback(
    (text: string) => {
      if (!text) return;
      lastAIQuestionRef.current = text;

      if (isAudioMutedRef.current) {
        setIsAISpeaking(false);
        setAvatarState('listening');
        return;
      }

      // 1. Temporarily abort speech recognition while AI talks to avoid capturing speaker echo
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch { /* best-effort; safe to ignore */ }
      }

      // 2. Clear any active HTML5 audio or speech utterance
      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause();
          activeAudioRef.current.currentTime = 0;
        } catch { /* best-effort; safe to ignore */ }
        activeAudioRef.current = null;
      }
      if (synthRef.current) {
        try {
          synthRef.current.cancel();
        } catch { /* best-effort; safe to ignore */ }
      }

      isAISpeakingRef.current = true;
      setIsAISpeaking(true);
      setAvatarState('speaking');

      let watchdogTimer: any = null;

      const finishAISpeech = () => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        stopAISpeechRef.current = null;
        activeAudioRef.current = null;
        (window as any).__activeUtterance = null;
        isAISpeakingRef.current = false;
        lastAISpeakEndRef.current = Date.now();
        setIsAISpeaking(false);
        setAvatarState('listening');
        setMicMuted(false);
        isMicMutedRef.current = false;
        setLiveStudentSpeech('');
        liveStudentSpeechRef.current = '';

        // Acoustic delay to clear room speaker echo, then auto-listen for candidate voice
        setTimeout(() => {
          if (!isMicMutedRef.current && !isProcessingTurnRef.current) {
            try {
              recognitionRef.current?.start();
            } catch { /* best-effort; safe to ignore */ }
          }
        }, 350);
      };

      // Barge-in stops playback; the question text stays in the transcript as context
      stopAISpeechRef.current = () => {
        if (activeAudioRef.current) {
          try {
            activeAudioRef.current.pause();
          } catch { /* best-effort; safe to ignore */ }
        }
        if (synthRef.current) {
          try {
            synthRef.current.cancel();
          } catch { /* best-effort; safe to ignore */ }
        }
        finishAISpeech();
      };

      // Safety Watchdog: Prevent stuck speaking state if audio or speech fails
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const maxSpeechDurationMs = Math.max(4000, Math.min(35000, wordCount * 500 + 3000));
      watchdogTimer = setTimeout(() => {
        console.warn('[TTS Watchdog] Speech synthesis auto-cleared speaking lock.');
        finishAISpeech();
      }, maxSpeechDurationMs);

      // Browser Fallback if backend Neural Audio is unavailable or blocked
      const playBrowserTTSFallback = () => {
        console.warn('[TTS] Falling back to Web Speech Synthesis API');
        if (!synthRef.current || isAudioMutedRef.current) {
          finishAISpeech();
          return;
        }
        try {
          synthRef.current.cancel();
          synthRef.current.resume();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          (window as any).__activeUtterance = utterance;

          const voices = synthRef.current.getVoices();
          const naturalVoice = voices.find(
            (v) =>
              v.lang.startsWith('en') &&
              (v.name.includes('Natural') ||
                v.name.includes('Google') ||
                v.name.includes('David') ||
                v.name.includes('Guy') ||
                v.name.includes('Christopher') ||
                v.name.includes('Samantha') ||
                v.name.includes('Jenny'))
          ) || voices.find((v) => v.lang.startsWith('en'));

          if (naturalVoice) utterance.voice = naturalVoice;

          utterance.onend = () => finishAISpeech();
          utterance.onerror = () => finishAISpeech();
          currentUtteranceRef.current = utterance;
          synthRef.current.speak(utterance);
        } catch {
          finishAISpeech();
        }
      };

      // Prepare Neural TTS streaming request
      const voice = selectedVoiceRef.current || 'christopher';
      const sanitizedText = text.slice(0, 1000);
      const audioUrl = `/api/v1/voice/synthesize?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(sanitizedText)}`;

      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;

      audio.onplay = () => {
        isAISpeakingRef.current = true;
        setIsAISpeaking(true);
        setAvatarState('speaking');
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch { /* best-effort; safe to ignore */ }
        }
      };

      audio.onended = () => {
        finishAISpeech();
      };

      audio.onerror = (e) => {
        console.warn('[Edge Neural TTS] Audio load error, falling back to browser TTS:', e);
        playBrowserTTSFallback();
      };

      audio.play().catch((err) => {
        console.warn('[Edge Neural TTS] Autoplay blocked, falling back to browser TTS:', err);
        playBrowserTTSFallback();
      });
    },
    [setIsAISpeaking, setAvatarState, setMicMuted]
  );

  // Silence Detection & Turn Auto-Advance Handlers
  const resetSilenceDetection = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setSilenceCountdown(null);
  }, []);

  const handleStudentAnswer = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText || isProcessingTurnRef.current) return;

      resetSilenceDetection();

      // Immediately abort recognition while processing turn to avoid stray input
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch { /* best-effort; safe to ignore */ }
      }
      setMicMuted(true);
      isMicMutedRef.current = true;

      setIsStudentSpeaking(false);
      setPartialTranscript('');
      setLiveStudentSpeech('');
      liveStudentSpeechRef.current = '';
      setInputTextFallback('');

      addTranscriptMessage({ speaker: 'student', text: cleanText });

      setIsProcessingTurn(true);
      setAvatarState('thinking');

      const startTime = Date.now();
      const inputMode = answerSourceRef.current;
      const questionBase = Math.max(lastAISpeakEndRef.current || 0, questionReadyAtRef.current || 0);
      const speech = {
        inputMode,
        responseLatencyMs: inputMode === 'voice' && firstSpeechAtRef.current
          ? Math.max(0, firstSpeechAtRef.current - questionBase)
          : Math.max(0, startTime - questionBase),
        speakingDurationMs: inputMode === 'voice' && firstSpeechAtRef.current
          ? Math.max(0, lastSpeechAtRef.current - firstSpeechAtRef.current)
          : undefined,
        interrupted: interruptionCountRef.current > 0,
        interruptionCount: interruptionCountRef.current
      };
      firstSpeechAtRef.current = 0;
      lastSpeechAtRef.current = 0;
      interruptionCountRef.current = 0;
      answerSourceRef.current = 'text';

      try {
        const response = await interviewApi.sendDialogueTurn(
          sessionId,
          cleanText,
          session?.jobRole || 'Software Development Engineer',
          session?.persona || 'Technical Lead',
          speech
        );
        questionReadyAtRef.current = Date.now();

        const elapsed = Date.now() - startTime;
        setLastTurnLatencyMs(elapsed);
        setIsProcessingTurn(false);

        if (typeof response.nextPhaseIndex === 'number') {
          setPhase(response.nextPhaseIndex);
        }

        // Real-Time Word-by-Word Streaming Effect into the chat bubble
        const fullAIResponse = response.aiResponse;
        const words = fullAIResponse.split(' ');

        setIsStreamingText(true);
        addTranscriptMessage({ speaker: 'ai', text: words[0] });

        let wordIdx = 1;
        const streamInterval = setInterval(() => {
          if (wordIdx < words.length) {
            wordIdx++;
            const currentSlice = words.slice(0, wordIdx).join(' ');
            updateLastTranscriptMessage(currentSlice);
          } else {
            clearInterval(streamInterval);
            setIsStreamingText(false);
          }
        }, 26);

        // Speak next question out loud in real-time
        speakAI(fullAIResponse);
      } catch (err) {
        setIsProcessingTurn(false);
        setAvatarState('idle');
        // The answer never reached the server: drop it from the transcript and let the student resend it
        const current = useInterviewStore.getState().session;
        if (current && current.transcript.length > 0) {
          setFullSession({ ...current, transcript: current.transcript.slice(0, -1) });
        }
        setInputTextFallback(cleanText);
        const reason = getFriendlyErrorMessage(err);
        // Server messages already say to resend; only add the hint when they do not
        toast.error(/send your answer again|try again/i.test(reason) ? reason : `${reason} Your answer was not sent. Please try again.`);
      }
    },
    [
      sessionId,
      setFullSession,
      session?.jobRole,
      session?.persona,
      resetSilenceDetection,
      setMicMuted,
      setIsStudentSpeaking,
      setPartialTranscript,
      addTranscriptMessage,
      setAvatarState,
      setPhase,
      updateLastTranscriptMessage,
      speakAI
    ]
  );

  const startSilenceCountdown = useCallback(() => {
    resetSilenceDetection();

    let seconds = 2;
    setSilenceCountdown(seconds);

    countdownIntervalRef.current = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        setSilenceCountdown(seconds);
      } else {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        setSilenceCountdown(null);
      }
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      resetSilenceDetection();
      const candidateAnswer = (liveStudentSpeechRef.current || partialTranscript || '').trim();
      if (candidateAnswer && !isProcessingTurnRef.current && !isAISpeakingRef.current) {
        handleStudentAnswer(candidateAnswer);
      }
    }, 1800);
  }, [resetSilenceDetection, handleStudentAnswer, partialTranscript]);


  // Initialize Web Speech API & Recognition Watchdog
  useEffect(() => {
    setConnectionStatus('connected');

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          setMicPermission(true);
        };

        recognition.onerror = (event: any) => {
          // Ignore 'no-speech' error: quiet pauses between candidate thinking are expected
          if (event.error === 'no-speech') {
            return;
          }
          if (event.error === 'not-allowed') {
            setMicPermission(false, 'Microphone access denied in browser settings.');
          }
        };

        recognition.onresult = (event: any) => {
          // Guard: do not transcribe while AI is speaking or turn is processing
          if (isAISpeakingRef.current || isProcessingTurnRef.current) {
            setPartialTranscript('');
            return;
          }

          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }

          if (!isInterviewStartedRef.current) {
            isInterviewStartedRef.current = true;
          }

          if (interim || final) {
            const now = Date.now();
            if (!firstSpeechAtRef.current) firstSpeechAtRef.current = now;
            lastSpeechAtRef.current = now;
            answerSourceRef.current = 'voice';
          }

          if (interim) {
            setIsStudentSpeaking(true);
            setPartialTranscript(interim);
            resetSilenceDetection();
          }

          if (final.trim()) {
            setIsStudentSpeaking(false);
            setPartialTranscript('');
            const cleaned = final.trim();
            setLiveStudentSpeech((prev) => {
              const updated = prev ? `${prev} ${cleaned}` : cleaned;
              liveStudentSpeechRef.current = updated;
              setInputTextFallback(updated);
              return updated;
            });

            // Start auto-advance countdown as soon as candidate speaks any word
            startSilenceCountdown();
          }
        };

        recognition.onend = () => {
          if (!isMicMutedRef.current && !isAISpeakingRef.current && !isProcessingTurnRef.current) {
            setTimeout(() => {
              try {
                recognition.start();
              } catch { /* best-effort; safe to ignore */ }
            }, 200);
          }
        };

        // Auto-start recognition on load
        try {
          recognition.start();
        } catch { /* best-effort; safe to ignore */ }

        recognitionRef.current = recognition;
      } catch (err) {
        console.warn('SpeechRecognition startup error:', err);
      }
    } else {
      setMicPermission(false, 'Web Speech API not supported in this browser. Fallback text input enabled.');
    }

    // Periodic heartbeat to ensure microphone recognition stays active
    const recognitionHeartbeat = setInterval(() => {
      if (
        recognitionRef.current &&
        !isMicMutedRef.current &&
        !isAISpeakingRef.current &&
        !isProcessingTurnRef.current
      ) {
        try {
          recognitionRef.current.start();
        } catch { /* best-effort; safe to ignore */ }
      }
    }, 3500);

    return () => {
      clearInterval(recognitionHeartbeat);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch { /* best-effort; safe to ignore */ }
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [
    setConnectionStatus,
    setMicPermission,
    setIsStudentSpeaking,
    setPartialTranscript,
    resetSilenceDetection,
    startSilenceCountdown
  ]);

  const ensureMicAnalyser = useCallback(async () => {
    if (micStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioContextRef.current = ctx;
        analyserRef.current = analyser;
      }
    } catch (e) {
      console.warn('Microphone stream access error:', e);
      toast.error('Microphone is blocked. Allow microphone access in the browser address bar, or type your answers.', { id: 'mic-blocked' });
    }
  }, []);

  useEffect(() => {
    // The first question is on screen from mount; later questions reset this when they arrive
    questionReadyAtRef.current = Date.now();
    void ensureMicAnalyser();
  }, [ensureMicAnalyser]);

  // Handle student clicking "Click to Speak" / "Mute" with Web Audio hardware link
  const handleToggleMic = async () => {
    if (isMicMuted) {
      setMicMuted(false);
      isMicMutedRef.current = false;
      toast.success('Microphone on. Speak clearly.');

      // Connect real-time Web Audio API stream
      await ensureMicAnalyser();

      if (recognitionRef.current && !isAISpeakingRef.current && !isProcessingTurnRef.current) {
        try {
          recognitionRef.current.start();
        } catch { /* best-effort; safe to ignore */ }
      }
    } else {
      setMicMuted(true);
      isMicMutedRef.current = true;
      resetSilenceDetection();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch { /* best-effort; safe to ignore */ }
      }
      setIsStudentSpeaking(false);
      setPartialTranscript('');
      toast('Microphone muted.');
    }
  };

  // One-click send candidate's spoken speech immediately
  const handleSendSpokenAnswer = () => {
    resetSilenceDetection();
    const candidateAnswer = (liveStudentSpeechRef.current || partialTranscript || inputTextFallback || '').trim();
    if (candidateAnswer) {
      handleStudentAnswer(candidateAnswer);
    }
  };

  // Clear current spoken speech buffer
  const handleClearSpeech = () => {
    resetSilenceDetection();
    setLiveStudentSpeech('');
    liveStudentSpeechRef.current = '';
    setPartialTranscript('');
    setInputTextFallback('');
  };

  // Submit Text/Voice Input Fallback
  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!(inputTextFallback || '').trim()) return;
    handleStudentAnswer((inputTextFallback || '').trim());
  };

  const handleEndInterview = async () => {
    setShowEndModal(false);
    if (synthRef.current) synthRef.current.cancel();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { /* best-effort; safe to ignore */ }
    }
    try {
      await interviewApi.endInterview(sessionId);
      navigate(`/interview/${sessionId}/end`);
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err));
    }
  };

  const currentPhaseName = session?.currentPhase || INTERVIEW_PHASES[0];
  const lastAIQuestionText = [...(session?.transcript || [])].reverse().find((t) => t.speaker === 'ai')?.text || '';

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-12">
      {/* 1. Real-time Status & Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between p-4 bg-white dark:bg-[#171716] border border-gray-200 dark:border-gray-800 rounded-lg shadow-sm gap-4 transition-colors">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
              {session?.companyTarget || 'Amazon'} • {session?.interviewType || 'Technical Round'}
            </span>
          </div>
          <Badge variant="accent" size="sm">
            {session?.persona || 'Technical Lead'}
          </Badge>
        </div>

        {/* Real-time Hardware & Latency Telemetry */}
        <div className="hidden md:flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 bg-rose-500/10 border border-rose-500/40 text-rose-600 dark:text-rose-400 px-3 py-1 rounded-xl text-[11px] font-mono font-bold">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            <span>Strict mode: bar raiser</span>
          </div>
          {lastTurnLatencyMs !== null && (
            <div className="flex items-center space-x-1.5 bg-brand-500/10 border border-brand-500/30 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-xl text-[11px] font-mono font-semibold" title="Time taken by the last AI reply">
              <Zap className="w-3.5 h-3.5" />
              <span>Last reply {(lastTurnLatencyMs / 1000).toFixed(1)}s</span>
            </div>
          )}
          {session?.resumeContext && (
            <div className="flex items-center space-x-1.5 bg-brand-500/10 border border-brand-500/30 text-brand-600 dark:text-brand-300 px-3 py-1 rounded-xl text-[11px] font-semibold">
              <FileText className="w-3.5 h-3.5 text-brand-400" />
              <span>Resume: {session.resumeContext.hotspots?.[0]?.title ? session.resumeContext.hotspots[0].title.slice(0, 22) + '...' : 'Projects Grounded'}</span>
            </div>
          )}
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-xl text-[11px] font-mono font-bold bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 animate-pulse">
            <span className="w-2 h-2 rounded-full inline-block bg-rose-500" />
            <span>REC • LIVE VOICE ACTIVE</span>
          </div>
        </div>

        {/* Phase Timeline Chip */}
        <div className="flex items-center space-x-2 bg-gray-50 dark:bg-[#1F1F1E] px-3.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700/60">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold">Phase:</span>
          <span className="text-xs font-bold text-brand-600 dark:text-brand-300 font-mono">
            {currentPhaseName}
          </span>
        </div>

        {/* Controls: Studio Neural Voice Selector, Voice Toggle, Timer & End Button */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Studio Neural Voice Persona Selector */}
          <div className="flex items-center space-x-1.5 bg-gray-50 dark:bg-[#1F1F1E] px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700/60 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-brand-500" />
            <label htmlFor="voice-select" className="text-[11px] text-gray-500 dark:text-gray-400 font-bold hidden md:inline">
              Voice:
            </label>
            <select
              id="voice-select"
              value={selectedVoice}
              onChange={(e) => {
                const newVoice = e.target.value;
                setSelectedVoice(newVoice);
                selectedVoiceRef.current = newVoice;
                if (lastAIQuestionRef.current && !isAudioMutedRef.current) {
                  speakAI(lastAIQuestionRef.current);
                }
              }}
              className="bg-transparent text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none cursor-pointer"
              title="Select Human Voice Persona (Powered by Microsoft Neural Speech)"
            >
              <option value="christopher" className="dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                Christopher (Staff SDE, US)
              </option>
              <option value="guy" className="dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                Guy (Technical Lead, US)
              </option>
              <option value="jenny" className="dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                Jenny (Principal SDE, US)
              </option>
              <option value="prabhat" className="dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                Prabhat (Senior Architect, IN)
              </option>
              <option value="neerja" className="dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                Neerja (Staff Bar Raiser, IN)
              </option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              const nextMuted = !isAudioMuted;
              setIsAudioMuted(nextMuted);
              if (!nextMuted) {
                if (lastAIQuestionRef.current) {
                  speakAI(lastAIQuestionRef.current);
                }
              }
            }}
            className={`p-2 rounded-xl border transition-all text-xs font-medium flex items-center gap-1.5 ${
              isAudioMuted
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300 hover:border-emerald-400'
            }`}
            title={isAudioMuted ? 'Unmute Interviewer Voice' : 'Interviewer Voice Active (Click to Mute)'}
          >
            {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span className="hidden sm:inline">{isAudioMuted ? 'Voice Muted' : 'Voice Active'}</span>
          </button>

          {/* Real-time Session Clock */}
          <div className="flex items-center space-x-1.5 text-xs font-mono font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-[#1F1F1E] px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-800">
            <Clock className="w-4 h-4 text-brand-600 dark:text-brand-400" />
            <span>{formatDuration(elapsedSeconds)}</span>
          </div>

          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowEndModal(true)}
            leftIcon={<PhoneOff className="w-3.5 h-3.5" />}
          >
            End Interview
          </Button>
        </div>
      </div>

      {/* 2. Main Live View: 50% Left Candidate AI Vision & Telemetry Stage, 50% Right Dialogue Transcript */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[640px]">
        {/* Left 50% Panel: Candidate Face Camera with AI Vision, Posture, Dress & Behavioral Tracking */}
        <div className="lg:col-span-6 flex flex-col h-[640px]">
          <CandidateWebcam
            sessionId={sessionId}
            candidateName={user?.name || 'KASINATHAN M'}
            isMicMuted={isMicMuted}
            onToggleMic={handleToggleMic}
            isStudentSpeaking={isStudentSpeaking}
            isAISpeaking={isAISpeaking}
            interviewerName={session?.persona || 'Interviewer'}
            audioFreqBars={audioFreqBars}
          />
        </div>

        {/* Right 50% Panel: Scrollable JetBrains Mono Real-Time Transcript */}
        <Card className="lg:col-span-6 p-6 bg-white dark:bg-[#171716] border-gray-200 dark:border-gray-800 flex flex-col justify-between h-[640px] shadow-sm rounded-lg">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3 mb-4">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <Award className="w-4 h-4 text-brand-600 dark:text-brand-400" />
              Real-Time Interview Dialogue
            </h3>
            <span className="text-[11px] font-mono text-gray-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Live Streaming Active
            </span>
          </div>

          {/* Autoplay Audio Unlock Notice if browser has not yet registered a click gesture */}
          {!isAudioUnlocked && (
            <div
              onClick={() => {
                setIsAudioUnlocked(true);
                isAudioUnlockedRef.current = true;
                if (lastAIQuestionRef.current) {
                  speakAI(lastAIQuestionRef.current);
                }
              }}
              className="cursor-pointer mb-3 p-3 rounded-xl bg-brand-600 text-white flex items-center justify-between hover:bg-brand-700 transition-all"
            >
              <div className="flex items-center gap-2 text-xs font-bold">
                <Volume2 className="w-4 h-4" />
                <span>Interviewer Voice Ready • Tap here to unlock audio speech</span>
              </div>
              <span className="text-[11px] bg-white text-brand-700 px-3 py-1 rounded-lg font-bold">
                Enable Voice
              </span>
            </div>
          )}

          {/* Messages Flow */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 font-mono text-xs">
            {session?.transcript.map((msg, index) => {
              const isLastMessage = index === session.transcript.length - 1;
              return (
                <div
                  key={msg.id}
                  className={`p-4 rounded-lg max-w-[88%] leading-relaxed transition-all glass-panel ${
                    msg.speaker === 'ai'
                      ? 'bg-gray-100/50 dark:bg-[#1E1E1C]/60 text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-800 mr-auto shadow-sm'
                      : 'bg-brand-600/90 text-white dark:bg-brand-600/30 dark:text-brand-100 border-brand-500/50 ml-auto'
                  }`}
                >
                  <div className="text-[11px] font-bold mb-1 opacity-80 flex items-center justify-between">
                    <span>{msg.speaker === 'ai' ? session?.persona || 'Interviewer' : 'Candidate (You)'}</span>
                    <div className="flex items-center gap-2">
                      {msg.speaker === 'ai' && (
                        <button
                          type="button"
                          onClick={() => {
                            speakAI(msg.text);
                          }}
                          className="hover:bg-brand-500/20 px-2 py-0.5 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300 transition-colors text-[11px] flex items-center gap-1 font-semibold"
                          title="Replay Voice Speech"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          <span>Listen</span>
                        </button>
                      )}
                      {msg.speaker === 'ai' && isLastMessage && isStreamingText && (
                        <span className="text-[11px] text-emerald-500 font-mono">Streaming</span>
                      )}
                    </div>
                  </div>
                  <p className="whitespace-pre-line text-[13px]">
                    {msg.text}
                    {msg.speaker === 'ai' && isLastMessage && isStreamingText && (
                      <span className="inline-block w-2 h-4 ml-1 bg-brand-500 animate-pulse align-middle" />
                    )}
                  </p>
                </div>
              );
            })}

            {/* Live Partial Student Transcript (Interim Speech recognition) */}
            {partialTranscript && !isMicMuted && (
              <div className="p-4 rounded-lg max-w-[88%] bg-brand-50 dark:bg-[#29437F]/50 text-brand-700 dark:text-brand-200 border border-brand-200 dark:border-brand-500/30 ml-auto animate-pulse">
                <div className="text-[11px] font-bold mb-1 opacity-70">
                  Transcribing in real-time...
                </div>
                <p className="italic text-[13px]">{partialTranscript}</p>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>

          {/* Voice-First Live Speech Subtitle & Caption Box */}
          {isAISpeaking ? (
            /* Interviewer Speaking Subtitle State */
            <div className="mt-4 p-4 rounded-lg bg-brand-50 dark:bg-[#1F1F1E] border border-brand-200 dark:border-brand-800/60 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow">
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-brand-600 dark:text-brand-400 flex items-center gap-1.5">
                    <Activity className="w-3 h-3 animate-spin" />
                    <span>Interviewer is Speaking...</span>
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 font-medium line-clamp-2 mt-0.5">
                    {lastAIQuestionText || 'Asking interview question...'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  speakAI(lastAIQuestionRef.current);
                }}
                className="px-3 py-1.5 rounded-lg bg-brand-600/10 hover:bg-brand-600/20 text-brand-600 dark:text-brand-400 text-xs font-semibold flex items-center gap-1 transition-all"
                title="Replay Spoken Question"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Replay</span>
              </button>
            </div>
          ) : isProcessingTurn ? (
            /* Real-Time Ollama Evaluation State */
            <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 flex items-center gap-3 shadow-sm">
              <Zap className="w-5 h-5 text-amber-500" />
              <div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                  Staff SDE Evaluating Technical Architecture...
                </div>
                <p className="text-xs text-amber-600/80 dark:text-amber-300/80 mt-0.5">
                  Custom AI model is testing your response against concurrency, failure modes, and algorithmic rigor.
                </p>
              </div>
            </div>
          ) : (
            /* Candidate Active Live Speech Box */
            <div className="mt-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-2.5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                  <span>Live Speech (What you are saying)</span>
                </div>
                {silenceCountdown !== null && (
                  <span className="text-xs font-mono font-bold text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-md border border-amber-500/30">
                    Auto-sending in {silenceCountdown}s...
                  </span>
                )}
              </div>

              {/* The Live Transcribed Words Display */}
              <div className="min-h-[52px] max-h-[84px] overflow-y-auto p-3 rounded-xl bg-white/90 dark:bg-[#1A1A19]/90 border border-emerald-500/20 text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed relative z-10">
                {liveStudentSpeech || partialTranscript ? (
                  <span>
                    {liveStudentSpeech}
                    {partialTranscript && <span className="opacity-60 italic"> {partialTranscript}</span>}
                  </span>
                ) : (
                  <span className="text-gray-400 italic font-normal">
                    Microphone active... Speak your response clearly. Your words will appear here live.
                  </span>
                )}
              </div>

              {/* Voice Controls: Done Speaking, Clear, Keyboard Fallback */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendSpokenAnswer}
                    disabled={!(liveStudentSpeech || '').trim() && !(partialTranscript || '').trim()}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow transition-all ${
                      (liveStudentSpeech || '').trim() || (partialTranscript || '').trim()
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white scale-105'
                        : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Done Speaking (Send Now)</span>
                  </button>
                  {((liveStudentSpeech || '').trim() || (partialTranscript || '').trim()) && (
                    <button
                      type="button"
                      onClick={handleClearSpeech}
                      className="text-xs text-gray-400 hover:text-rose-500 flex items-center gap-1 px-2 py-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowKeyboardFallback(!showKeyboardFallback)}
                  className="text-[11px] text-gray-500 hover:text-brand-500 underline flex items-center gap-1"
                >
                  <Keyboard className="w-3 h-3" />
                  <span>{showKeyboardFallback ? 'Hide Keyboard' : 'Type instead'}</span>
                </button>
              </div>

              {/* Optional Collapsed Keyboard Input (if in a noisy room) */}
              {showKeyboardFallback && (
                <form onSubmit={handleSend} className="pt-2 border-t border-gray-200/50 dark:border-gray-800/50 flex gap-2">
                  <input
                    type="text"
                    placeholder="Type answer manually if needed..."
                    value={inputTextFallback}
                    onChange={(e) => {
                      answerSourceRef.current = 'text';
                      setInputTextFallback(e.target.value);
                    }}
                    className="flex-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={!(inputTextFallback || '').trim() || isProcessingTurn}
                    className="px-3 py-2 bg-brand-600 text-white text-xs font-bold rounded-xl"
                  >
                    Send
                  </button>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Confirmation Dialog to End Interview */}
      <Modal
        isOpen={showEndModal}
        onClose={() => setShowEndModal(false)}
        title="Conclude Interview Session?"
        description="Are you sure you want to end this interview? Your responses will be evaluated in real-time across all 7 rubrics using custom AI model analysis."
      >
        <div className="flex justify-end space-x-3 pt-4">
          <Button variant="secondary" size="sm" onClick={() => setShowEndModal(false)}>
            Continue Interview
          </Button>
          <Button variant="danger" size="sm" onClick={handleEndInterview}>
            Yes, End & View Report
          </Button>
        </div>
      </Modal>
    </div>
  );
};
