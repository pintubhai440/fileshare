import React, { useState, useEffect, useRef } from 'react';
import { Tab } from './types';
import { ChatBot } from './components/ChatBot';
import Peer, { DataConnection } from 'peerjs';

interface FileMeta {
  name: string;
  size: number;
  type: string;
}

interface TransferStats {
  startTime: number;
  totalBytes: number;
  peakSpeed: number;
  averageSpeed: number;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.SEND);
  
  // PeerJS State
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Initializing...');
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  
  // Send State (MULTIPLE FILES SUPPORT)
  const [filesQueue, setFilesQueue] = useState<File[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState<string>('0.0 MB/s');
  
  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);
  const [isFileSaved, setIsFileSaved] = useState(false);
  
  // High Performance Refs
  const chunksRef = useRef<BlobPart[]>([]);
  const bytesReceivedRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  
  // Transfer Statistics
  const transferStatsRef = useRef<TransferStats>({
    startTime: 0,
    totalBytes: 0,
    peakSpeed: 0,
    averageSpeed: 0
  });
  
  // File System Access API
  const writableStreamRef = useRef<FileSystemWritableFileStream | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Initialize PeerJS
  useEffect(() => {
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const peer = new Peer(shortId, {
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

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setConnectionStatus(`Error: ${err.type}`);
    });

    peerRef.current = peer;

    return () => {
      peer.destroy();
    };
  }, []);

  // BEST SETTINGS FOR MAX SPEED
  const CHUNK_SIZE = 64 * 1024; // 64KB रखें
  const MAX_BUFFERED_AMOUNT = 32 * 1024 * 1024; // 32MB करें
  const DRAIN_THRESHOLD = 4 * 1024 * 1024; // 4MB पर resume करें
  const POLLING_INTERVAL = 2; // 2ms polling (aggressive)

  // Receiver Logic (FIXED FOR CORRUPTION)
  const setupReceiverEvents = (conn: DataConnection) => {
    conn.on('open', () => {
      setConnectionStatus(`Connected securely to ${conn.peer}`);
      // Set binary type for faster transfer
      if (conn.dataChannel) {
        conn.dataChannel.binaryType = 'arraybuffer';
      }
    });
    
    conn.on('data', async (data: any) => {
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;
      
      if (isBinary) {
        // FIX: Critical Data Handling
        const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
        
        // Motor Mode: Stream directly to disk
        if (writableStreamRef.current) {
          await writableStreamRef.current.write(chunk);
          bytesReceivedRef.current += chunk.byteLength;
        } else {
          // Fallback: Store in memory (Correctly)
          chunksRef.current.push(chunk);
          bytesReceivedRef.current += chunk.byteLength;
        }
        updateProgress();
      } 
      else if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        
        // Reset everything for new file
        chunksRef.current = [];
        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();
        setIsTransferComplete(false);
        setIsMotorReady(false);
        setIsFileSaved(false);
        setTransferProgress(0);
        setTransferSpeed('Starting...');
        
        // Initialize transfer stats
        transferStatsRef.current = {
          startTime: Date.now(),
          totalBytes: 0,
          peakSpeed: 0,
          averageSpeed: 0
        };
        
        // Close any existing stream
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
        }
      } 
      else if (data.type === 'end') {
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
          setIsFileSaved(true);
        }
        setTransferProgress(100);
        setTransferSpeed('Completed');
        setIsTransferComplete(true);
        
        // Calculate final stats
        const totalTime = (Date.now() - transferStatsRef.current.startTime) / 1000;
        const avgSpeed = (bytesReceivedRef.current / totalTime) / (1024 * 1024);
        transferStatsRef.current.averageSpeed = avgSpeed;
      } 
      else if (data.type === 'ready_to_receive') {
        // Sender is ready
      }
      else if (data.type === 'file_complete') {
        // Individual file complete in queue
        console.log(`File ${data.index + 1} completed`);
      }
    });
    
    conn.on('close', () => {
      setConnectionStatus('Connection Closed');
      setTransferProgress(0);
      setTransferSpeed('0.0 MB/s');
    });
  };

  // Motor - Prepare file system for streaming
  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;
    const meta = receivedFileMetaRef.current;
    
    // Check browser support safely
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: meta.name,
          types: [{
            description: 'File Transfer',
            accept: { [meta.type]: [] }
          }]
        });
        
        writableStreamRef.current = await handle.createWritable();
        setIsMotorReady(true);
        setTransferSpeed('Motor Ready ⚡');
        
        // Notify sender we're ready
        connRef.current.send({ type: 'ready_to_receive' });
      } catch (err) {
        console.log("User cancelled file save dialog");
        // Don't error out, just let them use fallback
        setTransferSpeed('Save cancelled (Using Fallback)');
        // Still continue with fallback
        setIsMotorReady(true);
        connRef.current.send({ type: 'ready_to_receive' });
      }
    } else {
      // Fallback mode for Firefox/Mobile
      setIsMotorReady(true); // Auto-ready without popup
      connRef.current.send({ type: 'ready_to_receive' });
      setTransferSpeed('Ready (Auto-Save Mode)');
    }
  };

  // Progress update function
  const updateProgress = () => {
    if (!receivedFileMetaRef.current) return;
    
    const now = Date.now();
    if (now - lastUpdateRef.current < 300) return;
    
    const total = receivedFileMetaRef.current.size;
    const percent = Math.min(100, Math.round((bytesReceivedRef.current / total) * 100));
    const bytesDiff = bytesReceivedRef.current - lastBytesRef.current;
    const timeDiff = (now - lastUpdateRef.current) / 1000;
    
    if (timeDiff > 0) {
      const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
      setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
      
      // Update peak speed
      if (speedMBps > transferStatsRef.current.peakSpeed) {
        transferStatsRef.current.peakSpeed = speedMBps;
      }
      
      // Update total bytes
      transferStatsRef.current.totalBytes = bytesReceivedRef.current;
    }
    
    setTransferProgress(percent);
    
    lastUpdateRef.current = now;
    lastBytesRef.current = bytesReceivedRef.current;
  };

  // Sender Logic
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFilesQueue(Array.from(e.target.files));
      setCurrentFileIndex(0);
      setTransferProgress(0);
      setTransferSpeed('0.0 MB/s');
    }
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current) return;
    
    setConnectionStatus('Connecting...');
    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), {
      reliable: true
    });
    connRef.current = conn;
    setupReceiverEvents(conn);
  };

  // Send all files in queue
  const sendAllFiles = () => {
    if (!connRef.current || filesQueue.length === 0) {
      alert("No connection or files!");
      return;
    }
    
    // Start with the first file
    processFileQueue(0);
  };

  const processFileQueue = (index: number) => {
    if (index >= filesQueue.length) {
      setTransferSpeed('All Files Sent Successfully! 🎉');
      return;
    }

    const file = filesQueue[index];
    setCurrentFileIndex(index);
    const conn = connRef.current!;

    // 1. Send file metadata
    conn.send({
      type: 'meta',
      meta: {
        name: file.name,
        size: file.size,
        type: file.type
      }
    });

    setTransferProgress(1);
    setTransferSpeed(`Waiting for receiver to accept: ${file.name}...`);

    // 2. Wait for 'ready_to_receive' for THIS file
    const onReady = (data: any) => {
      if (data.type === 'ready_to_receive') {
        conn.off('data', onReady);
        
        // 3. Start Pumping this file
        startPumping(conn, file, () => {
          // 4. On Complete, trigger next file
          setTimeout(() => {
            processFileQueue(index + 1);
          }, 500);
        });
      }
    };

    conn.on('data', onReady);
  };

  // 🔥 AGGRESSIVE SPEED ENGINE with BEST SETTINGS
  const startPumping = (conn: DataConnection, file: File, onComplete: () => void) => {
    // BEST SETTINGS FOR MAX SPEED:
    const CHUNK_SIZE = 64 * 1024; // 64KB रखें
    const MAX_BUFFERED_AMOUNT = 32 * 1024 * 1024; // 32MB करें
    const DRAIN_THRESHOLD = 4 * 1024 * 1024; // 4MB पर resume करें
    const POLLING_INTERVAL = 2; // 2ms polling (aggressive)

    const fileReader = new FileReader();
    let offset = 0;
    let totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let chunksSent = 0;

    lastUpdateRef.current = Date.now();
    lastBytesRef.current = 0;

    // Initialize sender stats
    const senderStats = {
      startTime: Date.now(),
      totalBytes: 0,
      peakSpeed: 0,
      averageSpeed: 0
    };

    const waitForDrain = () => {
      if (conn.dataChannel.bufferedAmount < DRAIN_THRESHOLD) {
        // Buffer 4MB तक खाली हो गया, वापस attack करो!
        readNextChunk();
      } else {
        // अभी भी full है, 2ms बाद check करो
        setTimeout(waitForDrain, POLLING_INTERVAL);
      }
    };

    fileReader.onload = (e) => {
      if (!e.target?.result) return;
      const buffer = e.target.result as ArrayBuffer;
      chunksSent++;

      try {
        conn.send(buffer);
        offset += buffer.byteLength;
        senderStats.totalBytes = offset;

        // UI Update Logic (Har 300ms pe update, taaki CPU free rahe)
        const now = Date.now();
        if (now - lastUpdateRef.current > 300) {
          const progress = Math.min(100, Math.round((offset / file.size) * 100));
          const bytesDiff = offset - lastBytesRef.current;
          const timeDiff = (now - lastUpdateRef.current) / 1000;
          if (timeDiff > 0) {
            const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
            setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
            
            // Update peak speed
            if (speedMBps > senderStats.peakSpeed) {
              senderStats.peakSpeed = speedMBps;
            }
          }
          setTransferProgress(progress);
          lastUpdateRef.current = now;
          lastBytesRef.current = offset;
        }

        if (offset < file.size) {
          // 🔥 CRITICAL LOOP LOGIC 🔥
          // Agar buffer me jagah hai, to turant agla packet padho (No waiting)
          if (conn.dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
            readNextChunk();
          } else {
            // Agar buffer full hai, to wait karo
            waitForDrain();
          }
        } else {
          conn.send({ type: 'end' });
          setTransferProgress(100);
          setTransferSpeed('Sent');
          
          // Calculate final average speed
          const totalTime = (Date.now() - senderStats.startTime) / 1000;
          senderStats.averageSpeed = (file.size / totalTime) / (1024 * 1024);
          
          console.log(`File sent: ${file.name}, Avg Speed: ${senderStats.averageSpeed.toFixed(1)} MB/s, Peak: ${senderStats.peakSpeed.toFixed(1)} MB/s`);
          
          onComplete();
        }
      } catch (err) {
        console.error("Error sending, retrying...", err);
        setTimeout(readNextChunk, 100);
      }
    };

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    readNextChunk();
  };

  // Save Function (Fallback for non-motor mode)
  const handleSaveFile = async () => {
    const meta = receivedFileMetaRef.current || receivedFileMeta;
    if (!meta) {
      alert("Error: File metadata missing.");
      return;
    }
    
    if (chunksRef.current.length === 0 && !writableStreamRef.current) {
      alert("Error: No file data received.");
      return;
    }
    
    setTransferSpeed('Saving to Disk...');
    
    try {
      if (writableStreamRef.current || isFileSaved) {
        setTransferSpeed('Already Saved via Motor ⚡');
        return;
      }
      
      // Safe Blob Creation
      const blob = new Blob(chunksRef.current, { type: meta.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      if (!meta.name.includes('.')) {
        const ext = meta.type.split('/')[1] || 'bin';
        a.download = `${meta.name}.${ext}`;
      } else {
        a.download = meta.name;
      }
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferSpeed('Saved (Standard)');
      setIsFileSaved(true);
    } catch (err) {
      console.error("Save failed:", err);
      setTransferSpeed('Save Failed');
    }
  };

  // Drag and drop support
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFilesQueue(Array.from(e.dataTransfer.files));
      setCurrentFileIndex(0);
      setTransferProgress(0);
      setTransferSpeed('0.0 MB/s');
    }
  };

  // Clear files queue
  const clearFilesQueue = () => {
    setFilesQueue([]);
    setCurrentFileIndex(0);
    setTransferProgress(0);
    setTransferSpeed('0.0 MB/s');
  };

  // Remove single file from queue
  const removeFileFromQueue = (index: number) => {
    const newQueue = [...filesQueue];
    newQueue.splice(index, 1);
    setFilesQueue(newQueue);
    if (currentFileIndex >= index && currentFileIndex > 0) {
      setCurrentFileIndex(currentFileIndex - 1);
    }
  };

  // Copy Peer ID to clipboard
  const copyPeerId = () => {
    navigator.clipboard.writeText(myPeerId);
    alert('Peer ID copied to clipboard!');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      {/* Background Effects */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/10 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              TurboShare Pro
            </span>
          </div>
          <div className="text-xs bg-gray-800 px-3 py-1 rounded-full border border-gray-700 flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            Status: <span className="text-green-400 font-mono">{connectionStatus}</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        {/* Tab Switcher */}
        <div className="bg-gray-800 p-1 rounded-xl inline-flex mb-8 shadow-lg border border-gray-700">
          <button
            onClick={() => setActiveTab(Tab.SEND)}
            className={`px-8 py-3 rounded-lg transition-all ${activeTab === Tab.SEND ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            📤 I want to SEND
          </button>
          <button
            onClick={() => setActiveTab(Tab.RECEIVE)}
            className={`px-8 py-3 rounded-lg transition-all ${activeTab === Tab.RECEIVE ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            📥 I want to RECEIVE
          </button>
        </div>

        {/* Device ID Display */}
        <div className="mb-8 text-center">
          <p className="text-gray-400 text-sm mb-2">Your Device ID (Share this)</p>
          <div className="flex items-center gap-3">
            <div className="text-4xl font-mono font-bold text-yellow-400 tracking-widest bg-black/30 px-6 py-3 rounded-xl border border-yellow-400/30 select-all">
              {myPeerId || '...'}
            </div>
            <button
              onClick={copyPeerId}
              className="bg-gray-800 hover:bg-gray-700 px-4 py-3 rounded-xl border border-gray-700"
              title="Copy to clipboard"
            >
              📋
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Share this ID with the other person to connect</p>
        </div>

        {/* Main Panel */}
        <div className="w-full max-w-2xl bg-gray-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {activeTab === Tab.SEND && (
            <div className="space-y-6">
              {/* File Select with Drag & Drop */}
              <div 
                className="border-2 border-dashed border-gray-600 rounded-2xl p-8 text-center relative hover:border-blue-500 transition-colors"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="space-y-2">
                  <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">📁</span>
                  </div>
                  <p className="text-xl font-medium">
                    {filesQueue.length > 0 
                      ? `${filesQueue.length} files selected` 
                      : "Select Files to Send"}
                  </p>
                  <p className="text-sm text-gray-400">Drag & drop or click to select files</p>
                  
                  {filesQueue.length > 0 && (
                    <>
                      <div className="text-xs text-gray-400 max-h-32 overflow-y-auto mt-4">
                        {filesQueue.map((f, i) => (
                          <div 
                            key={i} 
                            className={`flex items-center justify-between p-2 rounded-lg mb-1 ${i === currentFileIndex ? "bg-blue-500/20" : "bg-gray-900/30"}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={i === currentFileIndex ? "text-blue-400" : "text-gray-400"}>
                                {i === currentFileIndex ? '▶️' : '📄'}
                              </span>
                              <span className="truncate max-w-xs">{f.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">{(f.size / (1024 * 1024)).toFixed(2)} MB</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFileFromQueue(i);
                                }}
                                className="text-gray-500 hover:text-red-400"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={clearFilesQueue}
                        className="mt-2 text-sm text-red-400 hover:text-red-300"
                      >
                        Clear All
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Receiver ID Input */}
              <div className="flex gap-2 items-center bg-gray-900 p-4 rounded-xl border border-gray-700">
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Receiver's Device ID</p>
                  <input
                    type="text"
                    placeholder="Enter Receiver's ID here"
                    value={remotePeerId}
                    onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                    className="bg-transparent w-full outline-none text-white font-mono uppercase placeholder-gray-500"
                  />
                </div>
                <button
                  onClick={connectToPeer}
                  className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 px-6 py-3 rounded-lg font-medium transition-all"
                >
                  Connect
                </button>
              </div>

              {/* Progress Display */}
              {transferProgress > 0 && (
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-xs text-gray-400 px-1">
                    <span>Sending File {currentFileIndex + 1} of {filesQueue.length}</span>
                    <span className="text-green-400 font-mono font-bold">{transferSpeed}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden relative">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full transition-all duration-200"
                      style={{ width: `${transferProgress}%` }}
                    ></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-[10px] font-bold text-white drop-shadow-md">
                        {transferProgress}%
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Send Button */}
              <button
                onClick={sendAllFiles}
                disabled={filesQueue.length === 0 || !connectionStatus.includes('Connected')}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform hover:scale-[1.02]"
              >
                🚀 Send All Files
              </button>

              {/* Speed Settings Info */}
              <div className="text-xs text-gray-500 text-center mt-4">
                <p>⚡ Turbo Mode: 64KB chunks • 32MB buffer • 4MB drain threshold • 2ms polling</p>
              </div>
            </div>
          )}

          {activeTab === Tab.RECEIVE && (
            <div className="space-y-6 text-center">
              <h2 className="text-2xl font-bold">Ready to Receive</h2>
              <p className="text-gray-400">
                Your ID: <span className="text-yellow-400 font-mono font-bold text-lg">{myPeerId}</span>
              </p>

              {receivedFileMeta ? (
                <div className="bg-gray-700/50 p-4 rounded-xl mt-4">
                  {/* File Info */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-left">
                      <p className="font-bold text-lg text-blue-300">{receivedFileMeta.name}</p>
                      <p className="text-sm text-gray-400">
                        {(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB • {receivedFileMeta.type}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${transferSpeed.includes('⚡') ? 'text-cyan-400 animate-pulse' : 'text-green-400'}`}>
                        {transferSpeed}
                      </p>
                      <p className="text-xs text-gray-400">Current Speed</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs text-gray-400 px-1">
                      <span>Progress</span>
                      <span>{transferProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-600 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-green-500 to-emerald-400 h-full transition-all duration-200 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                        style={{ width: `${transferProgress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Motor Confirmation Button */}
                  {!isMotorReady && !isTransferComplete && (
                    <button
                      onClick={prepareMotor}
                      className="mt-6 w-full bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 px-4 py-4 rounded-xl font-bold shadow-lg flex items-center justify-center gap-3 transition-all"
                    >
                      <span className="text-lg">⚡</span>
                      <span>Confirm & Start Receiving</span>
                      <span className="text-xs bg-black/30 px-2 py-1 rounded">Motor Mode</span>
                    </button>
                  )}

                  {/* Fallback Save Button */}
                  {isTransferComplete && !writableStreamRef.current && !isFileSaved && (
                    <button
                      onClick={handleSaveFile}
                      className="mt-6 w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 py-4 rounded-xl font-bold text-lg shadow-lg transition-all"
                    >
                      💾 Save File Now
                    </button>
                  )}

                  {/* Status Messages */}
                  {isMotorReady && !isTransferComplete && (
                    <div className="mt-4 p-4 bg-cyan-900/20 border border-cyan-700 rounded-xl">
                      <p className="text-cyan-300 font-bold flex items-center justify-center gap-2">
                        <span className="animate-pulse">⚡</span> Motor Mode Active
                      </p>
                      <p className="text-sm text-cyan-400 mt-1">Streaming directly to disk</p>
                    </div>
                  )}

                  {isTransferComplete && (writableStreamRef.current || isFileSaved) && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-green-900/20 to-emerald-900/20 border border-emerald-700 rounded-xl">
                      <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                        <span className="text-2xl">✅</span>
                      </div>
                      <p className="text-emerald-300 font-bold text-lg">✓ File saved successfully!</p>
                      <p className="text-xs text-emerald-400 mt-1">Check your downloads folder</p>
                    </div>
                  )}

                  {/* Stats Info */}
                  {transferStatsRef.current.peakSpeed > 0 && (
                    <div className="mt-4 text-xs text-gray-400">
                      <p>Peak Speed: <span className="text-yellow-400">{transferStatsRef.current.peakSpeed.toFixed(1)} MB/s</span></p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-gray-500 text-sm mt-4 p-8 border-2 border-dashed border-gray-700 rounded-2xl">
                  <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">⏳</span>
                  </div>
                  <p className="text-lg mb-2">Waiting for sender to connect...</p>
                  <p className="text-sm">Share your ID with the sender</p>
                  <p className="text-xs mt-4 text-gray-600">Your connection is encrypted end-to-end</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Performance Stats */}
        <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-2xl">
          <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400">Connection</p>
            <p className={`text-lg font-bold ${connectionStatus.includes('Connected') ? 'text-green-400' : 'text-yellow-400'}`}>
              {connectionStatus.includes('Connected') ? '🟢 Live' : '🟡 Idle'}
            </p>
          </div>
          <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400">Files in Queue</p>
            <p className="text-lg font-bold">{filesQueue.length}</p>
          </div>
          <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400">Transfer Mode</p>
            <p className="text-lg font-bold">⚡ Turbo</p>
          </div>
        </div>
      </main>

      {/* Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="w-14 h-14 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 transition-transform"
          >
            💬
          </button>
        )}

        {isChatOpen && (
          <div className="w-[350px] h-[500px] flex flex-col relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
            <div className="bg-gradient-to-r from-blue-600 to-cyan-500 p-4 rounded-t-2xl">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span>🤖</span>
                  <span className="font-bold">AI Assistant</span>
                </div>
                <button
                  onClick={() => setIsChatOpen(false)}
                  className="w-8 h-8 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1">
              <ChatBot />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 text-center text-gray-500 text-sm mt-12 pb-6">
        <p>TurboShare Pro • Powered by WebRTC & PeerJS</p>
        <p className="text-xs mt-1">End-to-end encrypted • No servers involved</p>
      </footer>
    </div>
  );
};

export default App;
