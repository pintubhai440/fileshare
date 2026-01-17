import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tab } from './types';
import { ChatBot } from './components/ChatBot';
import Peer, { DataConnection } from 'peerjs';

interface FileMeta {
  name: string;
  size: number;
  type: string;
}

interface TransferLog {
  id: string;
  timestamp: Date;
  type: 'send' | 'receive';
  fileName: string;
  fileSize: number;
  status: 'success' | 'failed' | 'cancelled';
  speed: string;
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
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([]);
  
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
  
  // File System Access API
  const writableStreamRef = useRef<FileSystemWritableFileStream | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Transfer Statistics
  const totalTransferredRef = useRef<number>(0);
  const [totalFilesTransferred, setTotalFilesTransferred] = useState<number>(0);
  const [averageSpeed, setAverageSpeed] = useState<number>(0);
  const speedSamplesRef = useRef<number[]>([]);

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
      addTransferLog('system', 'Peer initialized', 'success');
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus(`Connected to ${conn.peer}`);
      addTransferLog('receive', `Connection from ${conn.peer}`, 'success');
      setupReceiverEvents(conn);
    });

    peer.on('error', (err) => {
      console.error('PeerJS Error:', err);
      addTransferLog('system', `Error: ${err.type}`, 'failed');
    });

    peerRef.current = peer;

    return () => {
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  // Add transfer log
  const addTransferLog = (
    type: 'send' | 'receive' | 'system', 
    fileName: string, 
    status: 'success' | 'failed' | 'cancelled',
    fileSize?: number,
    speed?: string
  ) => {
    const log: TransferLog = {
      id: Date.now().toString(),
      timestamp: new Date(),
      type,
      fileName,
      fileSize: fileSize || 0,
      status,
      speed: speed || '0.0 MB/s'
    };
    
    setTransferLogs(prev => [log, ...prev.slice(0, 49)]); // Keep last 50 logs
  };

  // Enhanced Receiver Logic
  const setupReceiverEvents = (conn: DataConnection) => {
    conn.on('open', () => {
      setConnectionStatus(`Connected securely to ${conn.peer}`);
      addTransferLog('receive', `Secure connection established`, 'success');
    });
    
    conn.on('data', async (data: any) => {
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;
      
      if (isBinary) {
        const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
        
        // Motor Mode: Stream directly to disk
        if (writableStreamRef.current) {
          try {
            await writableStreamRef.current.write(chunk);
            bytesReceivedRef.current += chunk.byteLength;
          } catch (error) {
            console.error('Stream write error:', error);
            chunksRef.current.push(chunk);
          }
        } else {
          chunksRef.current.push(chunk);
          bytesReceivedRef.current += chunk.byteLength;
        }
        updateProgress();
      } 
      else if (data.type === 'meta') {
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        
        // Reset for new file
        chunksRef.current = [];
        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();
        setIsTransferComplete(false);
        setIsMotorReady(false);
        setIsFileSaved(false);
        setTransferProgress(0);
        setTransferSpeed('Starting...');
        
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
        }
        
        addTransferLog('receive', `Receiving: ${data.meta.name}`, 'success', data.meta.size);
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
        
        const meta = receivedFileMetaRef.current;
        if (meta) {
          totalTransferredRef.current += meta.size;
          setTotalFilesTransferred(prev => prev + 1);
          addTransferLog('receive', `Completed: ${meta.name}`, 'success', meta.size, transferSpeed);
        }
      } 
      else if (data.type === 'ready_to_receive') {
        // Receiver is ready
      }
      else if (data.type === 'transfer_cancelled') {
        addTransferLog('receive', 'Transfer cancelled by sender', 'cancelled');
        resetReceiverState();
      }
    });
    
    conn.on('close', () => {
      setConnectionStatus('Connection Closed');
      setTransferProgress(0);
      addTransferLog('system', 'Connection closed', 'cancelled');
    });
    
    conn.on('error', (err) => {
      console.error('Connection error:', err);
      addTransferLog('system', `Connection error: ${err.message}`, 'failed');
    });
  };

  // Enhanced Motor Mode
  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) return;
    
    const meta = receivedFileMetaRef.current;
    
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
        
        connRef.current.send({ type: 'ready_to_receive' });
        addTransferLog('receive', 'Motor mode activated', 'success');
      } catch (err) {
        console.log("File save cancelled");
        setIsMotorReady(true);
        connRef.current.send({ type: 'ready_to_receive' });
        setTransferSpeed('Ready (Fallback Mode)');
      }
    } else {
      setIsMotorReady(true);
      connRef.current.send({ type: 'ready_to_receive' });
      setTransferSpeed('Ready (Fallback Mode)');
    }
  };

  // Enhanced progress calculation
  const updateProgress = () => {
    if (!receivedFileMetaRef.current) return;
    
    const now = Date.now();
    if (now - lastUpdateRef.current < 200) return;
    
    const total = receivedFileMetaRef.current.size;
    const bytesReceived = bytesReceivedRef.current;
    const percent = Math.min(100, Math.round((bytesReceived / total) * 100));
    
    const bytesDiff = bytesReceived - lastBytesRef.current;
    const timeDiff = (now - lastUpdateRef.current) / 1000;
    
    if (timeDiff > 0) {
      const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
      const speedStr = `${speedMBps.toFixed(1)} MB/s`;
      
      // Update speed samples for average calculation
      speedSamplesRef.current.push(speedMBps);
      if (speedSamplesRef.current.length > 10) {
        speedSamplesRef.current.shift();
      }
      
      const avgSpeed = speedSamplesRef.current.reduce((a, b) => a + b, 0) / speedSamplesRef.current.length;
      setAverageSpeed(avgSpeed);
      
      setTransferSpeed(speedStr);
    }
    
    setTransferProgress(percent);
    lastUpdateRef.current = now;
    lastBytesRef.current = bytesReceived;
  };

  // File selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      
      // Sort by size (largest first for better throughput estimation)
      filesArray.sort((a, b) => b.size - a.size);
      
      setFilesQueue(filesArray);
      setCurrentFileIndex(0);
      setTransferProgress(0);
      setTransferSpeed('0.0 MB/s');
      
      // Log file selection
      filesArray.forEach((file, index) => {
        addTransferLog('send', `Queued: ${file.name}`, 'success', file.size);
      });
    }
  };

  // Connection management
  const connectToPeer = () => {
    if (!remotePeerId.trim() || !peerRef.current) return;
    
    setConnectionStatus('Connecting...');
    const peerId = remotePeerId.toUpperCase();
    
    try {
      const conn = peerRef.current.connect(peerId, {
        reliable: true,
        serialization: 'binary'
      });
      
      connRef.current = conn;
      setupReceiverEvents(conn);
      
      conn.on('open', () => {
        setConnectionStatus(`Connected to ${peerId}`);
        addTransferLog('send', `Connected to ${peerId}`, 'success');
      });
      
      conn.on('error', (err) => {
        setConnectionStatus(`Connection failed: ${err.message}`);
        addTransferLog('send', `Failed to connect to ${peerId}`, 'failed');
      });
    } catch (error) {
      setConnectionStatus('Connection error');
      addTransferLog('send', 'Connection error', 'failed');
    }
  };

  // Send all files with enhanced error handling
  const sendAllFiles = async () => {
    if (!connRef.current || filesQueue.length === 0) {
      alert("No connection or files!");
      return;
    }
    
    try {
      await processFileQueue(0);
    } catch (error) {
      console.error('Transfer error:', error);
      addTransferLog('send', 'Transfer failed', 'failed');
      alert('Transfer failed. Please try again.');
    }
  };

  // Enhanced file queue processing
  const processFileQueue = async (index: number): Promise<void> => {
    if (index >= filesQueue.length) {
      setTransferSpeed('All Files Sent Successfully! 🎉');
      
      // Calculate total transfer stats
      const totalSize = filesQueue.reduce((sum, file) => sum + file.size, 0);
      totalTransferredRef.current += totalSize;
      setTotalFilesTransferred(prev => prev + filesQueue.length);
      
      addTransferLog('send', `Completed ${filesQueue.length} files`, 'success', totalSize);
      return;
    }

    const file = filesQueue[index];
    setCurrentFileIndex(index);
    
    if (!connRef.current) {
      throw new Error('Connection lost');
    }

    const conn = connRef.current;

    try {
      // Send metadata
      conn.send({
        type: 'meta',
        meta: {
          name: file.name,
          size: file.size,
          type: file.type
        }
      });

      setTransferProgress(1);
      setTransferSpeed(`Preparing: ${file.name}...`);
      addTransferLog('send', `Starting: ${file.name}`, 'success', file.size);

      // Wait for receiver ready with timeout
      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Receiver timeout'));
        }, 30000);

        const onReady = (data: any) => {
          if (data.type === 'ready_to_receive') {
            clearTimeout(timeout);
            conn.off('data', onReady);
            resolve();
          }
        };

        conn.on('data', onReady);
      });

      await readyPromise;

      // Start transfer
      await startPumping(conn, file, (progress, speed) => {
        setTransferProgress(progress);
        setTransferSpeed(speed);
      });

      // File completed successfully
      addTransferLog('send', `Completed: ${file.name}`, 'success', file.size, transferSpeed);

      // Move to next file
      setTimeout(() => {
        processFileQueue(index + 1);
      }, 300);
    } catch (error) {
      addTransferLog('send', `Failed: ${file.name}`, 'failed', file.size);
      throw error;
    }
  };

  // ULTRA-OPTIMIZED TRANSFER ENGINE
  const startPumping = (
    conn: DataConnection,
    file: File,
    onProgress: (progress: number, speed: string) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const CHUNK_SIZE = 256 * 1024; // 256KB chunks for better performance
      const MAX_BUFFERED_AMOUNT = 64 * 1024 * 1024;
      const DRAIN_THRESHOLD = 8 * 1024 * 1024;
      const POLLING_INTERVAL = 1;
      const SPEED_UPDATE_INTERVAL = 100; // Update speed every 100ms

      const fileReader = new FileReader();
      let offset = 0;
      let isCancelled = false;
      let startTime = Date.now();
      let lastSpeedUpdate = startTime;
      let bytesSent = 0;
      let lastBytes = 0;

      const calculateSpeed = (): string => {
        const now = Date.now();
        const timeDiff = (now - lastSpeedUpdate) / 1000;
        
        if (timeDiff > 0) {
          const bytesDiff = bytesSent - lastBytes;
          const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
          lastSpeedUpdate = now;
          lastBytes = bytesSent;
          return `${speedMBps.toFixed(1)} MB/s`;
        }
        return '0.0 MB/s';
      };

      const waitForDrain = () => {
        if (isCancelled) return;
        
        if (conn.dataChannel.bufferedAmount < DRAIN_THRESHOLD) {
          readNextChunk();
        } else {
          setTimeout(waitForDrain, POLLING_INTERVAL);
        }
      };

      fileReader.onload = (e) => {
        if (isCancelled) return;
        
        if (!e.target?.result) {
          reject(new Error('File read error'));
          return;
        }

        const buffer = e.target.result as ArrayBuffer;
        
        try {
          // Send chunk
          conn.send(buffer);
          offset += buffer.byteLength;
          bytesSent += buffer.byteLength;
          
          // Calculate progress
          const progress = Math.min(100, Math.round((offset / file.size) * 100));
          
          // Update progress at regular intervals
          const now = Date.now();
          if (now - lastSpeedUpdate >= SPEED_UPDATE_INTERVAL || progress === 100) {
            const speed = calculateSpeed();
            onProgress(progress, speed);
          }

          if (offset < file.size) {
            // Check buffer and continue
            if (conn.dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
              readNextChunk();
            } else {
              waitForDrain();
            }
          } else {
            // Transfer complete
            conn.send({ type: 'end' });
            onProgress(100, 'Complete');
            resolve();
          }
        } catch (err) {
          if (!isCancelled) {
            setTimeout(() => readNextChunk(), 50);
          } else {
            reject(err);
          }
        }
      };

      fileReader.onerror = () => {
        if (!isCancelled) {
          reject(new Error('File read error'));
        }
      };

      const readNextChunk = () => {
        if (isCancelled || offset >= file.size) return;
        
        const nextChunkSize = Math.min(CHUNK_SIZE, file.size - offset);
        const slice = file.slice(offset, offset + nextChunkSize);
        fileReader.readAsArrayBuffer(slice);
      };

      // Start transfer
      readNextChunk();

      // Cleanup
      return () => {
        isCancelled = true;
        fileReader.abort();
      };
    });
  };

  // Enhanced Save Function
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
      
      const blob = new Blob(chunksRef.current, { type: meta.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferSpeed('Saved Successfully');
      setIsFileSaved(true);
      addTransferLog('receive', `Saved: ${meta.name}`, 'success', meta.size);
    } catch (err) {
      console.error("Save failed:", err);
      setTransferSpeed('Save Failed');
      addTransferLog('receive', `Save failed: ${meta.name}`, 'failed', meta.size);
    }
  };

  // Reset receiver state
  const resetReceiverState = () => {
    chunksRef.current = [];
    bytesReceivedRef.current = 0;
    lastBytesRef.current = 0;
    lastUpdateRef.current = 0;
    receivedFileMetaRef.current = null;
    setReceivedFileMeta(null);
    setIsTransferComplete(false);
    setIsMotorReady(false);
    setIsFileSaved(false);
    setTransferProgress(0);
    setTransferSpeed('0.0 MB/s');
  };

  // Disconnect from peer
  const disconnectPeer = () => {
    if (connRef.current) {
      connRef.current.close();
      connRef.current = null;
    }
    setConnectionStatus('Disconnected');
    setRemotePeerId('');
    addTransferLog('system', 'Disconnected', 'cancelled');
  };

  // Clear transfer logs
  const clearLogs = () => {
    setTransferLogs([]);
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative">
      {/* Background Effects */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/10 backdrop-blur-md bg-gray-900/50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            SecureShare Pro
          </span>
          <div className="flex items-center gap-4">
            <div className="text-xs bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
              Status: <span className="text-green-400">{connectionStatus}</span>
            </div>
            <div className="text-xs bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
              Transferred: <span className="text-blue-400">{totalFilesTransferred} files</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center">
        {/* Tab Switcher */}
        <div className="bg-gray-800 p-1 rounded-xl inline-flex mb-8 shadow-lg border border-gray-700">
          <button
            onClick={() => setActiveTab(Tab.SEND)}
            className={`px-8 py-3 rounded-lg ${activeTab === Tab.SEND ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            I want to SEND
          </button>
          <button
            onClick={() => setActiveTab(Tab.RECEIVE)}
            className={`px-8 py-3 rounded-lg ${activeTab === Tab.RECEIVE ? 'bg-purple-600 text-white' : 'text-gray-400'}`}
          >
            I want to RECEIVE
          </button>
        </div>

        {/* Device ID Display */}
        <div className="mb-8 text-center">
          <p className="text-gray-400 text-sm mb-2">Your Device ID (Share this)</p>
          <div className="text-4xl font-mono font-bold text-yellow-400 tracking-widest bg-black/30 px-6 py-2 rounded-xl border border-yellow-400/30 select-all">
            {myPeerId || '...'}
          </div>
          <p className="text-xs text-gray-500 mt-2">Avg Speed: {averageSpeed.toFixed(1)} MB/s</p>
        </div>

        {/* Main Panel */}
        <div className="w-full max-w-2xl bg-gray-800/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* SEND Tab */}
          {activeTab === Tab.SEND && (
            <div className="space-y-6">
              {/* File Selection */}
              <div className="border-2 border-dashed border-gray-600 rounded-2xl p-8 text-center relative hover:border-blue-500">
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="space-y-2">
                  <p className="text-xl font-medium">
                    {filesQueue.length > 0 
                      ? `${filesQueue.length} files selected` 
                      : "Select Files to Send"}
                  </p>
                  {filesQueue.length > 0 && (
                    <div className="text-xs text-gray-400 max-h-20 overflow-y-auto">
                      {filesQueue.map((f, i) => (
                        <div key={i} className={i === currentFileIndex ? "text-blue-400 font-bold" : ""}>
                          {i + 1}. {f.name} ({formatFileSize(f.size)})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Connection Input */}
              <div className="flex gap-2 items-center bg-gray-900 p-4 rounded-xl border border-gray-700">
                <input
                  type="text"
                  placeholder="Enter Receiver's ID here"
                  value={remotePeerId}
                  onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                  className="bg-transparent flex-1 outline-none text-white font-mono uppercase"
                />
                <div className="flex gap-2">
                  <button
                    onClick={connectToPeer}
                    className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm"
                  >
                    Connect
                  </button>
                  {connRef.current && (
                    <button
                      onClick={disconnectPeer}
                      className="bg-red-700 hover:bg-red-600 px-4 py-2 rounded-lg text-sm"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
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
                    <p className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-md">
                      {transferProgress}%
                    </p>
                  </div>
                </div>
              )}

              {/* Send Button */}
              <button
                onClick={sendAllFiles}
                disabled={filesQueue.length === 0 || connectionStatus.includes('Initializing')}
                className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-bold shadow-lg disabled:opacity-50"
              >
                Send All Files 🚀
              </button>
            </div>
          )}

          {/* RECEIVE Tab */}
          {activeTab === Tab.RECEIVE && (
            <div className="space-y-6 text-center">
              <h2 className="text-2xl font-bold">Ready to Receive</h2>
              <p className="text-gray-400">
                Your ID: <span className="text-yellow-400 font-mono font-bold text-lg">{myPeerId}</span>
              </p>

              {receivedFileMeta && (
                <div className="bg-gray-700/50 p-4 rounded-xl mt-4">
                  <p className="font-bold text-lg text-blue-300">Receiving: {receivedFileMeta.name}</p>
                  <p className="text-sm text-gray-400">
                    {formatFileSize(receivedFileMeta.size)}
                  </p>

                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs text-gray-400 px-1">
                      <span>Progress</span>
                      <span className={`font-mono font-bold ${transferSpeed.includes('⚡') ? 'text-cyan-400 animate-pulse' : 'text-green-400'}`}>
                        {transferSpeed}
                      </span>
                    </div>
                    <div className="w-full bg-gray-600 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-green-500 h-full transition-all duration-200 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                        style={{ width: `${transferProgress}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-right text-gray-300 font-bold">{transferProgress}%</p>
                  </div>

                  {/* Motor Confirmation Button */}
                  {!isMotorReady && !isTransferComplete && (
                    <button
                      onClick={prepareMotor}
                      className="mt-4 w-full bg-green-600 hover:bg-green-500 px-4 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2"
                    >
                      <span>Confirm & Start Receiving</span>
                      <span className="text-lg">⚡</span>
                    </button>
                  )}

                  {/* Fallback Save Button */}
                  {isTransferComplete && !writableStreamRef.current && !isFileSaved && (
                    <button
                      onClick={handleSaveFile}
                      className="mt-4 block w-full bg-purple-600 hover:bg-purple-500 py-3 rounded-xl font-bold shadow-lg"
                    >
                      Save File Now 💾
                    </button>
                  )}

                  {/* Already Saved Message */}
                  {isTransferComplete && (writableStreamRef.current || isFileSaved) && (
                    <div className="mt-4 p-3 bg-cyan-900/30 border border-cyan-700 rounded-xl">
                      <p className="text-cyan-300 font-bold">✓ File saved directly to disk!</p>
                      <p className="text-xs text-cyan-400 mt-1">Check your downloads folder</p>
                    </div>
                  )}
                </div>
              )}

              {!receivedFileMeta && (
                <div className="text-gray-500 text-sm mt-4">
                  Waiting for sender to connect...
                  <p className="text-xs mt-2">Share your ID above with the sender</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Transfer Logs Panel */}
        <div className="w-full max-w-2xl mt-8 bg-gray-800/30 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold">Transfer Logs</h3>
            <button
              onClick={clearLogs}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
            >
              Clear
            </button>
          </div>
          
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transferLogs.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No transfers yet</p>
            ) : (
              transferLogs.map((log) => (
                <div 
                  key={log.id}
                  className={`p-3 rounded-lg text-sm ${
                    log.status === 'success' ? 'bg-green-900/20 border border-green-800/30' :
                    log.status === 'failed' ? 'bg-red-900/20 border border-red-800/30' :
                    'bg-yellow-900/20 border border-yellow-800/30'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className={`font-bold ${
                        log.type === 'send' ? 'text-blue-400' :
                        log.type === 'receive' ? 'text-purple-400' :
                        'text-gray-400'
                      }`}>
                        {log.type === 'send' ? '📤 SEND' : 
                         log.type === 'receive' ? '📥 RECEIVE' : '⚙️ SYSTEM'}
                      </span>
                      <span className="ml-2 text-gray-300">{log.fileName}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {log.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                  </div>
                  {log.fileSize > 0 && (
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-gray-400">{formatFileSize(log.fileSize)}</span>
                      <span className={`font-mono ${
                        log.status === 'success' ? 'text-green-400' :
                        log.status === 'failed' ? 'text-red-400' :
                        'text-yellow-400'
                      }`}>
                        {log.speed}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="w-14 h-14 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full shadow-2xl flex items-center justify-center text-white"
          >
            💬
          </button>
        )}

        {isChatOpen && (
          <div className="w-[350px] h-[500px] flex flex-col relative">
            <button
              onClick={() => setIsChatOpen(false)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-gray-700 text-white rounded-full flex items-center justify-center shadow-lg z-10"
            >
              X
            </button>
            <ChatBot />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
