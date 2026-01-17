import React, { useState, useEffect, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { Tab } from './types';
import { ChatBot } from './components/ChatBot';

interface FileMeta {
  name: string;
  size: number;
  type: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.SEND);

  const [myPeerId, setMyPeerId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  // SEND
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [remotePeerId, setRemotePeerId] = useState('');

  // RECEIVE
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);

  // UI
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState('0 MB/s');
  const [isChatOpen, setIsChatOpen] = useState(false);

  // PERFORMANCE REFS
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);

  // 🔥 MOTOR
  const writableStreamRef = useRef<FileSystemWritableFileStream | null>(null);

  // --------------------------------------------------
  // PEER INIT
  // --------------------------------------------------
  useEffect(() => {
    const id = Math.random().toString(36).substring(2, 6).toUpperCase();
    const peer = new Peer(id, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    peer.on('open', (id) => {
      setMyPeerId(id);
      setConnectionStatus('Ready');
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus(`Connected to ${conn.peer}`);
      setupReceiverEvents(conn);
    });

    peerRef.current = peer;
    return () => peer.destroy();
  }, []);

  // --------------------------------------------------
  // RECEIVER
  // --------------------------------------------------
  const setupReceiverEvents = (conn: DataConnection) => {
    conn.on('data', async (data: any) => {
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;

      if (isBinary && writableStreamRef.current) {
        const buffer = data instanceof Uint8Array ? data.buffer : data;
        await writableStreamRef.current.write(buffer);

        bytesReceivedRef.current += buffer.byteLength;
        updateProgress();
      }

      else if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);

        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();

        setIsMotorReady(false);
        setTransferProgress(0);
        setTransferSpeed('Waiting for confirmation...');
      }

      else if (data.type === 'end') {
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
        }
        setTransferProgress(100);
        setTransferSpeed('Finished');
        setIsTransferComplete(true);
      }
    });
  };

  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;

    // @ts-ignore
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: receivedFileMetaRef.current.name
      });
      writableStreamRef.current = await handle.createWritable();
      setTransferSpeed('Motor Ready ⚡');
      setIsMotorReady(true);

      connRef.current.send({ type: 'ready_to_receive' });
    } else {
      setTransferSpeed('Fast mode not supported');
    }
  };

  const updateProgress = () => {
    if (!receivedFileMetaRef.current) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < 500) return;

    const total = receivedFileMetaRef.current.size;
    const percent = Math.min(100, Math.round((bytesReceivedRef.current / total) * 100));

    const bytesDiff = bytesReceivedRef.current - lastBytesRef.current;
    const timeDiff = (now - lastUpdateRef.current) / 1000;
    const speed = (bytesDiff / timeDiff) / (1024 * 1024);

    setTransferProgress(percent);
    setTransferSpeed(`${speed.toFixed(1)} MB/s`);

    lastUpdateRef.current = now;
    lastBytesRef.current = bytesReceivedRef.current;
  };

  // --------------------------------------------------
  // SENDER
  // --------------------------------------------------
  const connectToPeer = () => {
    if (!peerRef.current || !remotePeerId) return;
    const conn = peerRef.current.connect(remotePeerId);
    connRef.current = conn;
    setupReceiverEvents(conn);
  };

  const sendFile = () => {
    if (!fileToSend || !connRef.current) return;
    const conn = connRef.current;

    conn.send({
      type: 'meta',
      meta: {
        name: fileToSend.name,
        size: fileToSend.size,
        type: fileToSend.type
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'ready_to_receive') {
        startPumping();
      }
    });
  };

  const startPumping = () => {
    if (!fileToSend || !connRef.current) return;

    const conn = connRef.current;
    const CHUNK_SIZE = 16 * 1024 * 1024;
    const reader = new FileReader();
    let offset = 0;

    reader.onload = () => {
      if (!reader.result) return;
      conn.send(reader.result);
      offset += (reader.result as ArrayBuffer).byteLength;

      if (offset < fileToSend.size) readNext();
      else conn.send({ type: 'end' });
    };

    const readNext = () => {
      if (conn.dataChannel.bufferedAmount > 64 * 1024 * 1024) {
        setTimeout(readNext, 30);
        return;
      }
      const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readNext();
  };

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="p-6 text-center font-mono text-3xl text-yellow-400">
        {myPeerId}
      </div>

      <div className="flex justify-center gap-4 mb-6">
        <button onClick={() => setActiveTab(Tab.SEND)}>SEND</button>
        <button onClick={() => setActiveTab(Tab.RECEIVE)}>RECEIVE</button>
      </div>

      {activeTab === Tab.SEND && (
        <div className="p-6 space-y-4">
          <input type="file" onChange={e => setFileToSend(e.target.files?.[0] || null)} />
          <input
            placeholder="Receiver ID"
            value={remotePeerId}
            onChange={e => setRemotePeerId(e.target.value.toUpperCase())}
          />
          <button onClick={connectToPeer}>Connect</button>
          <button onClick={sendFile}>Send</button>
        </div>
      )}

      {activeTab === Tab.RECEIVE && receivedFileMeta && (
        <div className="p-6 space-y-3 text-center">
          <p className="font-bold">{receivedFileMeta.name}</p>
          <p>{transferProgress}%</p>
          <p>{transferSpeed}</p>

          {!isMotorReady && (
            <button
              onClick={prepareMotor}
              className="bg-green-600 px-4 py-2 rounded font-bold"
            >
              Confirm & Start Receiving
            </button>
          )}
        </div>
      )}

      <div className="fixed bottom-6 right-6">
        {!isChatOpen && <button onClick={() => setIsChatOpen(true)}>💬</button>}
        {isChatOpen && <ChatBot />}
      </div>
    </div>
  );
};

export default App;
