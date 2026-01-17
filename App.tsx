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

  // PEER
  const [myPeerId, setMyPeerId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  // SEND
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [remotePeerId, setRemotePeerId] = useState('');

  // RECEIVE
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);

  // UI
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState('0 MB/s');
  const [isChatOpen, setIsChatOpen] = useState(false);

  // PERF
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);

  // MOTOR STREAM
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
      setConnectionStatus('Ready to Connect');
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
        setIsTransferComplete(false);
        setTransferProgress(0);
        setTransferSpeed('Waiting for confirmation...');
      }

      else if (data.type === 'end') {
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
        }
        setTransferProgress(100);
        setTransferSpeed('Completed');
        setIsTransferComplete(true);
      }
    });
  };

  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;

    // @ts-ignore
    if (!window.showSaveFilePicker) {
      setTransferSpeed('Fast mode not supported');
      return;
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: receivedFileMetaRef.current.name
    });

    writableStreamRef.current = await handle.createWritable();
    setIsMotorReady(true);
    setTransferSpeed('Motor Ready ⚡');

    connRef.current.send({ type: 'ready_to_receive' });
  };

  const updateProgress = () => {
    if (!receivedFileMetaRef.current) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < 300) return;

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
    setConnectionStatus('Connecting...');
    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), { reliable: true });
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
  // UI (100% SAME AS YOUR ORIGINAL)
  // --------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      <nav className="border-b border-white/10 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            SecureShare
          </span>
          <div className="text-xs bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
            Status: <span className="text-green-400">{connectionStatus}</span>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-12 flex flex-col items-center">
        <div className="bg-gray-800 p-1 rounded-xl inline-flex mb-8">
          <button onClick={() => setActiveTab(Tab.SEND)} className={`px-8 py-3 rounded-lg ${activeTab === Tab.SEND ? 'bg-blue-600' : 'text-gray-400'}`}>
            I want to SEND
          </button>
          <button onClick={() => setActiveTab(Tab.RECEIVE)} className={`px-8 py-3 rounded-lg ${activeTab === Tab.RECEIVE ? 'bg-purple-600' : 'text-gray-400'}`}>
            I want to RECEIVE
          </button>
        </div>

        <div className="text-4xl font-mono font-bold text-yellow-400 mb-8">
          {myPeerId}
        </div>

        {activeTab === Tab.SEND && (
          <div className="w-full max-w-xl space-y-4">
            <input type="file" onChange={e => setFileToSend(e.target.files?.[0] || null)} />
            <input
              value={remotePeerId}
              onChange={e => setRemotePeerId(e.target.value.toUpperCase())}
              placeholder="Receiver ID"
              className="w-full p-3 rounded bg-gray-800"
            />
            <button onClick={connectToPeer} className="w-full bg-gray-700 py-3 rounded">
              Connect
            </button>
            <button onClick={sendFile} className="w-full bg-blue-600 py-3 rounded font-bold">
              Send Instantly 🚀
            </button>
          </div>
        )}

        {activeTab === Tab.RECEIVE && receivedFileMeta && (
          <div className="text-center space-y-4">
            <p className="font-bold text-lg">{receivedFileMeta.name}</p>
            <p>{transferProgress}%</p>
            <p>{transferSpeed}</p>

            {!isMotorReady && (
              <button onClick={prepareMotor} className="bg-green-600 px-6 py-3 rounded font-bold">
                Confirm & Start Receiving
              </button>
            )}
          </div>
        )}
      </main>

      <div className="fixed bottom-6 right-6">
        {!isChatOpen && <button onClick={() => setIsChatOpen(true)}>💬</button>}
        {isChatOpen && <ChatBot />}
      </div>
    </div>
  );
};

export default App;
