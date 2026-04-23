import WebSocket from 'ws';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log('API Key present:', !!OPENAI_API_KEY);

const ws = new WebSocket(
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
  { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } }
);

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      turn_detection: { type: 'server_vad', threshold: 0.85, prefix_padding_ms: 600, silence_duration_ms: 1500, create_response: true },
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw',
      voice: 'alloy',
      instructions: 'You are a helpful assistant.',
      modalities: ['text', 'audio'],
      temperature: 0.8,
      input_audio_transcription: { model: 'whisper-1' },
    },
  }));
  console.log('📤 session.update sent');
  setTimeout(() => { ws.close(); process.exit(0); }, 6000);
});

ws.on('message', (raw) => {
  const evt = JSON.parse(raw.toString());
  console.log('📨', evt.type, evt.error ? '→ ' + JSON.stringify(evt.error) : '');
  if (evt.type === 'error') console.log('FULL ERROR:', JSON.stringify(evt, null, 2));
});

ws.on('error', (err) => console.log('❌ WS Error:', err.message, err.code));
ws.on('close', (code, reason) => console.log('🔌 Closed:', code, reason?.toString()));
