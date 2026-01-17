import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tab } from './types';
import { ChatBot } from './components/ChatBot';
import Peer, { DataConnection } from 'peerjs';

interface FileMeta {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
}

interface TransferStats {
  startTime: number;
  endTime: number;
  totalBytes: number;
  speedHistory: number[];
}

interface QueuedFile {
  file: File;
  index: number;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  progress: number;
  speed: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.SEND);
  
  // PeerJS State
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Initializing...');
  const [isConnected, setIsConnected] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  
  // Send State (ENHANCED MULTIPLE FILES SUPPORT)
  const [filesQueue, setFilesQueue] = useState<QueuedFile[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState<string>('0.0 MB/s');
  const [estimatedTime, setEstimatedTime] = useState<string>('Calculating...');
  const [transferStats, setTransferStats] = useState<TransferStats | null>(null);
  
  // Receive State
  const [remotePeerId, setRemotePeerId] = useState('');
  const [receivedFileMeta, setReceivedFileMeta] = useState<FileMeta | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<Array<{meta: FileMeta, url: string}>>([]);
  const [isTransferComplete, setIsTransferComplete] = useState(false);
  const [isMotorReady, setIsMotorReady] = useState(false);
  const [isFileSaved, setIsFileSaved] = useState(false);
  const [receiverProgress, setReceiverProgress] = useState(0);
  
  // High Performance Refs
  const chunksRef = useRef<BlobPart[]>([]);
  const bytesReceivedRef = useRef(0);
  const bytesSentRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastBytesRef = useRef(0);
  const receivedFileMetaRef = useRef<FileMeta | null>(null);
  const speedHistoryRef = useRef<number[]>([]);
  
  // File System Access API
  const writableStreamRef = useRef<FileSystemWritableFileStream | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  
  // Statistics
  const [totalTransferred, setTotalTransferred] = useState(0);
  const [filesTransferred, setFilesTransferred] = useState(0);
  const [maxSpeed, setMaxSpeed] = useState(0);

  // Initialize PeerJS with better error handling
  useEffect(() => {
    const generateShortId = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const initializePeer = async () => {
      const shortId = generateShortId();
      
      try {
        const peer = new Peer(shortId, {
          debug: 0,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' }
            ]
          },
          secure: true
        });

        peer.on('open', (id) => {
          setMyPeerId(id);
          setConnectionStatus('Ready to Connect');
          setIsConnected(true);
          console.log('PeerJS initialized with ID:', id);
        });

        peer.on('connection', (conn) => {
          console.log('Incoming connection from:', conn.peer);
          connRef.current = conn;
          setConnectionStatus(`Connected to ${conn.peer}`);
          setIsConnected(true);
          setupReceiverEvents(conn);
          
          // Auto-switch to receive tab if sender connects
          if (activeTab === Tab.SEND) {
            setActiveTab(Tab.RECEIVE);
          }
        });

        peer.on('error', (err) => {
          console.error('PeerJS error:', err);
          setConnectionStatus(`Error: ${err.type}`);
          setIsConnected(false);
          
          // Attempt to reconnect
          if (err.type === 'lost' || err.type === 'disconnected') {
            setTimeout(() => {
              initializePeer();
            }, 2000);
          }
        });

        peer.on('disconnected', () => {
          console.log('Peer disconnected');
          setConnectionStatus('Disconnected - Reconnecting...');
          setIsConnected(false);
        });

        peer.on('close', () => {
          console.log('Peer closed');
          setConnectionStatus('Connection Closed');
          setIsConnected(false);
        });

        peerRef.current = peer;
      } catch (error) {
        console.error('Failed to initialize PeerJS:', error);
        setConnectionStatus('Failed to initialize - Retrying...');
        setTimeout(() => initializePeer(), 3000);
      }
    };

    initializePeer();

    return () => {
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  // Enhanced Receiver Logic with error handling
  const setupReceiverEvents = useCallback((conn: DataConnection) => {
    conn.on('open', () => {
      console.log('Data connection opened');
      setConnectionStatus(`Connected securely to ${conn.peer}`);
      setIsConnected(true);
    });
    
    conn.on('data', async (data: any) => {
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;
      
      if (isBinary) {
        // Handle binary data with proper typing
        const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
        
        // Motor Mode: Stream directly to disk
        if (writableStreamRef.current) {
          try {
            await writableStreamRef.current.write(chunk);
            bytesReceivedRef.current += chunk.byteLength;
          } catch (writeError) {
            console.error('Error writing to stream:', writeError);
            // Fallback to memory storage
            chunksRef.current.push(chunk);
          }
        } else {
          // Store in memory
          chunksRef.current.push(chunk);
          bytesReceivedRef.current += chunk.byteLength;
        }
        updateProgress();
      } 
      else if (data.type === 'meta') {
        console.log('Received file metadata:', data.meta);
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        
        // Reset state for new file
        chunksRef.current = [];
        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();
        setIsTransferComplete(false);
        setIsMotorReady(false);
        setIsFileSaved(false);
        setReceiverProgress(0);
        setTransferSpeed('Starting...');
        
        // Close any existing stream
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
        }
      } 
      else if (data.type === 'end') {
        console.log('Transfer complete');
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
          setIsFileSaved(true);
        }
        setReceiverProgress(100);
        setTransferSpeed('Completed');
        setIsTransferComplete(true);
        
        // Update statistics
        const meta = receivedFileMetaRef.current;
        if (meta) {
          setTotalTransferred(prev => prev + meta.size);
          setFilesTransferred(prev => prev + 1);
          
          // Create download URL for received file
          if (chunksRef.current.length > 0) {
            const blob = new Blob(chunksRef.current, { type: meta.type });
            const url = URL.createObjectURL(blob);
            setReceivedFiles(prev => [...prev, { meta, url }]);
          }
        }
      } 
      else if (data.type === 'ready_to_receive') {
        console.log('Receiver is ready');
      }
      else if (data.type === 'transfer_cancelled') {
        console.log('Transfer cancelled by sender');
        setConnectionStatus('Transfer cancelled');
        resetTransfer();
      }
    });
    
    conn.on('close', () => {
      console.log('Data connection closed');
      setConnectionStatus('Connection Closed');
      setIsConnected(false);
      setReceiverProgress(0);
    });
    
    conn.on('error', (err) => {
      console.error('Connection error:', err);
      setConnectionStatus(`Error: ${err.message}`);
    });
  }, []);

  // Enhanced Motor Mode with better file handling
  const prepareMotor = async () => {
    if (!receivedFileMetaRef.current || !connRef.current) {
      alert('No file metadata or connection available');
      return;
    }
    
    const meta = receivedFileMetaRef.current;
    setTransferSpeed('Preparing Motor Mode...');
    
    // Check for File System Access API support
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: meta.name,
          types: [{
            description: 'File Transfer',
            accept: { [meta.type]: [] }
          }],
          excludeAcceptAllOption: false
        });
        
        writableStreamRef.current = await handle.createWritable();
        setIsMotorReady(true);
        setTransferSpeed('Motor Ready ⚡');
        
        // Notify sender we're ready
        connRef.current.send({ type: 'ready_to_receive' });
        
        // Start progress tracking
        lastUpdateRef.current = Date.now();
        lastBytesRef.current = 0;
      } catch (err: any) {
        console.log('File save dialog cancelled or failed:', err);
        
        // User cancelled, fall back to auto mode
        if (err.name !== 'AbortError') {
          setIsMotorReady(true); // Auto-ready without popup
          connRef.current.send({ type: 'ready_to_receive' });
          setTransferSpeed('Ready (Auto-Save Mode)');
        } else {
          setTransferSpeed('Save cancelled');
        }
      }
    } else {
      // Fallback mode for Firefox/Mobile
      setIsMotorReady(true);
      connRef.current.send({ type: 'ready_to_receive' });
      setTransferSpeed('Ready (Auto-Save Mode)');
    }
  };

  // Enhanced progress update with ETA calculation
  const updateProgress = useCallback(() => {
    if (!receivedFileMetaRef.current) return;
    
    const now = Date.now();
    if (now - lastUpdateRef.current < 200) return;
    
    const total = receivedFileMetaRef.current.size;
    const bytesReceived = bytesReceivedRef.current;
    const percent = Math.min(100, Math.round((bytesReceived / total) * 100));
    
    // Calculate speed
    const bytesDiff = bytesReceived - lastBytesRef.current;
    const timeDiff = (now - lastUpdateRef.current) / 1000;
    const speedMBps = timeDiff > 0 ? (bytesDiff / timeDiff) / (1024 * 1024) : 0;
    
    // Update speed history
    speedHistoryRef.current.push(speedMBps);
    if (speedHistoryRef.current.length > 10) {
      speedHistoryRef.current.shift();
    }
    
    // Calculate average speed
    const avgSpeed = speedHistoryRef.current.reduce((a, b) => a + b, 0) / speedHistoryRef.current.length;
    
    // Calculate ETA
    const bytesRemaining = total - bytesReceived;
    const etaSeconds = avgSpeed > 0 ? bytesRemaining / (avgSpeed * 1024 * 1024) : Infinity;
    
    // Format ETA
    let etaString = 'Calculating...';
    if (etaSeconds < 60) {
      etaString = `${Math.ceil(etaSeconds)} seconds`;
    } else if (etaSeconds < 3600) {
      etaString = `${Math.ceil(etaSeconds / 60)} minutes`;
    } else {
      etaString = `${(etaSeconds / 3600).toFixed(1)} hours`;
    }
    
    // Update max speed
    if (speedMBps > maxSpeed) {
      setMaxSpeed(speedMBps);
    }
    
    setReceiverProgress(percent);
    setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
    setEstimatedTime(etaString);
    
    lastUpdateRef.current = now;
    lastBytesRef.current = bytesReceived;
  }, [maxSpeed]);

  // Enhanced file selection with validation
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const fileList = Array.from(e.target.files);
    const validFiles: QueuedFile[] = [];
    
    // Validate each file
    fileList.forEach((file, index) => {
      if (file.size > 2 * 1024 * 1024 * 1024) { // 2GB limit
        alert(`File "${file.name}" exceeds 2GB limit and will be skipped`);
        return;
      }
      
      validFiles.push({
        file,
        index,
        status: 'pending',
        progress: 0,
        speed: '0.0 MB/s'
      });
    });
    
    if (validFiles.length === 0) {
      alert('No valid files selected');
      return;
    }
    
    setFilesQueue(validFiles);
    setCurrentFileIndex(0);
    setOverallProgress(0);
    setTransferSpeed('0.0 MB/s');
    setEstimatedTime('Calculating...');
    
    // Calculate total size
    const totalSize = validFiles.reduce((sum, qf) => sum + qf.file.size, 0);
    console.log(`Selected ${validFiles.length} files, total size: ${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  };

  // Enhanced connection function
  const connectToPeer = () => {
    if (!remotePeerId.trim()) {
      alert('Please enter a Peer ID');
      return;
    }
    
    if (!peerRef.current) {
      alert('Peer not initialized yet');
      return;
    }
    
    const peerId = remotePeerId.toUpperCase().trim();
    setConnectionStatus('Connecting...');
    
    try {
      const conn = peerRef.current.connect(peerId, {
        reliable: true,
        serialization: 'binary'
      });
      
      connRef.current = conn;
      setupReceiverEvents(conn);
      
      conn.on('open', () => {
        setConnectionStatus(`Connected to ${peerId}`);
        setIsConnected(true);
      });
      
      conn.on('error', (err) => {
        console.error('Connection failed:', err);
        setConnectionStatus(`Failed to connect: ${err.message}`);
        setIsConnected(false);
      });
    } catch (error) {
      console.error('Connection error:', error);
      setConnectionStatus('Connection failed');
      setIsConnected(false);
    }
  };

  // Enhanced file queue processing
  const sendAllFiles = async () => {
    if (!connRef.current || !connRef.current.open) {
      alert('Not connected to a peer');
      return;
    }
    
    if (filesQueue.length === 0) {
      alert('No files selected');
      return;
    }
    
    // Initialize transfer stats
    const stats: TransferStats = {
      startTime: Date.now(),
      endTime: 0,
      totalBytes: filesQueue.reduce((sum, qf) => sum + qf.file.size, 0),
      speedHistory: []
    };
    setTransferStats(stats);
    
    // Update first file status
    setFilesQueue(prev => prev.map((qf, idx) => 
      idx === 0 ? { ...qf, status: 'sending' } : qf
    ));
    
    // Start sending files
    await processFileQueue(0);
  };

  // Enhanced file queue processing with better error handling
  const processFileQueue = async (index: number): Promise<void> => {
    if (index >= filesQueue.length) {
      // All files sent
      setTransferSpeed('All Files Sent Successfully! 🎉');
      if (transferStats) {
        setTransferStats(prev => prev ? {
          ...prev,
          endTime: Date.now()
        } : null);
      }
      return;
    }
    
    const queuedFile = filesQueue[index];
    const file = queuedFile.file;
    setCurrentFileIndex(index);
    
    if (!connRef.current) {
      alert('Connection lost');
      return;
    }
    
    const conn = connRef.current;
    
    try {
      // 1. Send file metadata
      conn.send({
        type: 'meta',
        meta: {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified
        }
      });
      
      setTransferSpeed(`Waiting for receiver to accept: ${file.name}...`);
      
      // Wait for receiver confirmation with timeout
      const waitForReady = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          conn.off('data', onReady);
          reject(new Error('Receiver not ready (timeout)'));
        }, 30000); // 30 second timeout
        
        const onReady = (data: any) => {
          if (data.type === 'ready_to_receive') {
            clearTimeout(timeout);
            conn.off('data', onReady);
            resolve();
          }
        };
        
        conn.on('data', onReady);
      });
      
      await waitForReady;
      
      // Start transferring the file
      await startPumping(conn, file, (progress, speed) => {
        // Update file progress
        setFilesQueue(prev => prev.map((qf, idx) => 
          idx === index ? { ...qf, progress, speed } : qf
        ));
        
        // Update overall progress
        const totalSize = filesQueue.reduce((sum, qf) => sum + qf.file.size, 0);
        const transferredSize = filesQueue.slice(0, index).reduce((sum, qf) => sum + qf.file.size, 0) + 
                               (file.size * progress / 100);
        const overallPercent = Math.round((transferredSize / totalSize) * 100);
        setOverallProgress(overallPercent);
      });
      
      // Mark file as sent
      setFilesQueue(prev => prev.map((qf, idx) => 
        idx === index ? { ...qf, status: 'sent', progress: 100 } : qf
      ));
      
      // Move to next file after a short delay
      setTimeout(() => {
        if (index + 1 < filesQueue.length) {
          setFilesQueue(prev => prev.map((qf, idx) => 
            idx === index + 1 ? { ...qf, status: 'sending' } : qf
          ));
        }
        processFileQueue(index + 1);
      }, 500);
      
    } catch (error) {
      console.error('Error sending file:', error);
      setFilesQueue(prev => prev.map((qf, idx) => 
        idx === index ? { ...qf, status: 'failed' } : qf
      ));
      setTransferSpeed(`Error: ${error.message}`);
    }
  };

  // 🔥 ULTRA-FAST TRANSFER ENGINE (Optimized for speed)
  const startPumping = (
    conn: DataConnection, 
    file: File, 
    onProgress: (progress: number, speed: string) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      // OPTIMAL SETTINGS FOR MAX SPEED
      const CHUNK_SIZE = 128 * 1024; // 128KB chunks
      const MAX_BUFFERED_AMOUNT = 64 * 1024 * 1024; // 64MB buffer
      const DRAIN_THRESHOLD = 8 * 1024 * 1024; // Resume at 8MB
      const POLLING_INTERVAL = 1; // 1ms polling (ultra-aggressive)
      
      const fileReader = new FileReader();
      let offset = 0;
      let isCancelled = false;
      let lastSpeedUpdate = Date.now();
      let bytesSentThisSecond = 0;

      // Speed calculation function
      const calculateSpeed = () => {
        const now = Date.now();
        const timeDiff = (now - lastSpeedUpdate) / 1000;
        
        if (timeDiff >= 1) {
          const speedMBps = (bytesSentThisSecond / timeDiff) / (1024 * 1024);
          bytesSentThisSecond = 0;
          lastSpeedUpdate = now;
          return speedMBps;
        }
        return null;
      };

      // Wait for buffer to drain
      const waitForDrain = () => {
        if (isCancelled) return;
        
        if (conn.dataChannel.bufferedAmount < DRAIN_THRESHOLD) {
          // Buffer has drained, resume sending
          readNextChunk();
        } else {
          // Still full, check again shortly
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
          // Send the chunk
          conn.send(buffer);
          offset += buffer.byteLength;
          bytesSentThisSecond += buffer.byteLength;
          bytesSentRef.current += buffer.byteLength;
          
          // Calculate progress
          const progress = Math.min(100, Math.round((offset / file.size) * 100));
          
          // Calculate speed
          const speed = calculateSpeed();
          if (speed !== null) {
            const speedStr = `${speed.toFixed(1)} MB/s`;
            onProgress(progress, speedStr);
            
            // Update transfer speed display
            setTransferSpeed(speedStr);
            
            // Update stats
            if (transferStats) {
              setTransferStats(prev => prev ? {
                ...prev,
                speedHistory: [...prev.speedHistory, speed]
              } : null);
            }
          }
          
          if (offset < file.size) {
            // Check buffer status and decide whether to continue
            if (conn.dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
              // Buffer has space, continue immediately
              readNextChunk();
            } else {
              // Buffer is full, wait for drain
              waitForDrain();
            }
          } else {
            // File transfer complete
            conn.send({ type: 'end' });
            onProgress(100, 'Complete');
            resolve();
          }
        } catch (err) {
          console.error('Error sending chunk:', err);
          
          // Retry after short delay
          if (!isCancelled) {
            setTimeout(() => readNextChunk(), 100);
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

      // Start the transfer
      readNextChunk();

      // Cleanup function
      return () => {
        isCancelled = true;
        fileReader.abort();
      };
    });
  };

  // Enhanced file saving with better error handling
  const handleSaveFile = async () => {
    const meta = receivedFileMetaRef.current || receivedFileMeta;
    if (!meta) {
      alert('Error: No file metadata available');
      return;
    }
    
    if (chunksRef.current.length === 0 && !writableStreamRef.current) {
      alert('Error: No file data received');
      return;
    }
    
    setTransferSpeed('Saving to Disk...');
    
    try {
      // If already saved via Motor mode
      if (writableStreamRef.current || isFileSaved) {
        setTransferSpeed('Already Saved via Motor ⚡');
        return;
      }
      
      // Create blob from chunks
      const blob = new Blob(chunksRef.current, { type: meta.type });
      
      // Try to use File System Access API first
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: meta.name,
            types: [{
              description: 'File Transfer',
              accept: { [meta.type]: [] }
            }]
          });
          
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          
          setTransferSpeed('Saved Successfully ✓');
          setIsFileSaved(true);
          return;
        } catch (err) {
          console.log('File System API failed, falling back to download');
        }
      }
      
      // Fallback: Use standard download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Ensure filename has proper extension
      let filename = meta.name;
      if (!filename.includes('.')) {
        const ext = meta.type.split('/')[1] || 'bin';
        filename = `${meta.name}.${ext}`;
      }
      a.download = filename;
      
      // Trigger download
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
      setTransferSpeed('Saved (Standard Download)');
      setIsFileSaved(true);
      
    } catch (err) {
      console.error('Save failed:', err);
      setTransferSpeed('Save Failed');
      alert('Failed to save file. Please try again.');
    }
  };

  // Reset transfer state
  const resetTransfer = () => {
    setFilesQueue([]);
    setCurrentFileIndex(0);
    setOverallProgress(0);
    setTransferSpeed('0.0 MB/s');
    setEstimatedTime('Calculating...');
    setReceiverProgress(0);
    setIsTransferComplete(false);
    setIsMotorReady(false);
    setIsFileSaved(false);
    setReceivedFileMeta(null);
    receivedFileMetaRef.current = null;
    chunksRef.current = [];
    bytesReceivedRef.current = 0;
    bytesSentRef.current = 0;
    speedHistoryRef.current = [];
  };

  // Cancel ongoing transfer
  const cancelTransfer = () => {
    if (connRef.current) {
      connRef.current.send({ type: 'transfer_cancelled' });
    }
    resetTransfer();
    setConnectionStatus('Transfer Cancelled');
  };

  // Copy Peer ID to clipboard
  const copyPeerId = () => {
    navigator.clipboard.writeText(myPeerId)
      .then(() => {
        alert('Peer ID copied to clipboard!');
      })
      .catch(err => {
        console.error('Failed to copy:', err);
      });
  };

  // Generate QR Code for Peer ID
  const generateQRCode = () => {
    // This would integrate with a QR code library
    alert('QR Code generation would be implemented here');
  };

  // Calculate transfer statistics
  const calculateStats = () => {
    if (!transferStats || transferStats.endTime === 0) return null;
    
    const duration = (transferStats.endTime - transferStats.startTime) / 1000; // seconds
    const totalMB = transferStats.totalBytes / (1024 * 1024);
    const avgSpeed = totalMB / duration;
    
    return {
      duration: `${duration.toFixed(1)}s`,
      totalSize: `${(totalMB / 1024).toFixed(2)} GB`,
      avgSpeed: `${avgSpeed.toFixed(1)} MB/s`,
      maxSpeed: `${maxSpeed.toFixed(1)} MB/s`
    };
  };

  const stats = calculateStats();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white relative overflow-x-hidden">
      {/* Animated Background */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-600/10 rounded-full blur-[140px] animate-pulse"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] bg-gradient-radial from-cyan-500/5 to-transparent"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/10 backdrop-blur-xl bg-gray-900/70 sticky top-0">
        <div className="container mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center font-bold text-lg">
              SS
            </div>
            <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-300 to-cyan-300">
              SecureShare Pro
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <div className="text-xs text-gray-400">Connection Status</div>
              <div className={`text-sm font-semibold ${isConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                {connectionStatus}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
              <button 
                onClick={() => setShowTransferHistory(!showTransferHistory)}
                className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg border border-gray-700 transition-all"
              >
                📊 Stats
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Transfer History Panel */}
      {showTransferHistory && (
        <div className="relative z-20 container mx-auto px-4 mt-6 animate-slideDown">
          <div className="bg-gray-800/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Transfer Statistics</h3>
              <button 
                onClick={() => setShowTransferHistory(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-900/50 p-4 rounded-xl">
                <div className="text-sm text-gray-400">Total Transferred</div>
                <div className="text-2xl font-bold text-cyan-300">
                  {(totalTransferred / (1024 * 1024 * 1024)).toFixed(2)} GB
                </div>
              </div>
              
              <div className="bg-gray-900/50 p-4 rounded-xl">
                <div className="text-sm text-gray-400">Files Transferred</div>
                <div className="text-2xl font-bold text-green-300">
                  {filesTransferred}
                </div>
              </div>
              
              <div className="bg-gray-900/50 p-4 rounded-xl">
                <div className="text-sm text-gray-400">Max Speed</div>
                <div className="text-2xl font-bold text-yellow-300">
                  {maxSpeed.toFixed(1)} MB/s
                </div>
              </div>
            </div>
            
            {stats && (
              <div className="mt-6 pt-4 border-t border-white/10">
                <h4 className="font-semibold mb-2">Last Transfer</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-gray-400">Duration</div>
                    <div className="font-mono">{stats.duration}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Size</div>
                    <div className="font-mono">{stats.totalSize}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Avg Speed</div>
                    <div className="font-mono">{stats.avgSpeed}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Max Speed</div>
                    <div className="font-mono">{stats.maxSpeed}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="relative z-10 container mx-auto px-4 py-8 flex flex-col items-center">
        {/* Tab Switcher */}
        <div className="bg-gray-800/80 backdrop-blur-xl p-1 rounded-2xl inline-flex mb-8 shadow-2xl border border-white/10">
          <button
            onClick={() => {
              setActiveTab(Tab.SEND);
              resetTransfer();
            }}
            className={`px-8 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === Tab.SEND ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
          >
            <span className="flex items-center gap-2">
              <span>📤</span>
              <span>SEND Files</span>
            </span>
          </button>
          <button
            onClick={() => {
              setActiveTab(Tab.RECEIVE);
              resetTransfer();
            }}
            className={`px-8 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === Tab.RECEIVE ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
          >
            <span className="flex items-center gap-2">
              <span>📥</span>
              <span>RECEIVE Files</span>
            </span>
          </button>
        </div>

        {/* Device ID Display with Actions */}
        <div className="w-full max-w-2xl mb-8">
          <div className="text-center mb-4">
            <p className="text-gray-400 text-sm mb-2">Your Unique Device ID</p>
            <div className="relative group">
              <div className="text-4xl font-mono font-bold bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-400 bg-clip-text text-transparent tracking-widest bg-black/30 px-6 py-3 rounded-2xl border border-yellow-400/30 select-all">
                {myPeerId || 'GENERATING...'}
              </div>
              <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={copyPeerId}
                  className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-full flex items-center justify-center text-xs border border-gray-700"
                  title="Copy ID"
                >
                  ⎘
                </button>
                <button
                  onClick={generateQRCode}
                  className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-full flex items-center justify-center text-xs border border-gray-700"
                  title="Show QR Code"
                >
                  ⚈
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">Share this ID with others to connect</p>
          </div>
        </div>

        {/* Main Panel */}
        <div className="w-full max-w-4xl bg-gray-800/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl mb-12">
          {/* SEND Tab */}
          {activeTab === Tab.SEND && (
            <div className="space-y-6 animate-fadeIn">
              {/* File Selection Area */}
              <div className="border-3 border-dashed border-gray-600 hover:border-blue-500 rounded-2xl p-8 text-center transition-all duration-300 relative group">
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  accept="*/*"
                  title=""
                />
                <div className="space-y-4">
                  <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-2xl flex items-center justify-center text-3xl">
                    📁
                  </div>
                  <div>
                    <p className="text-xl font-medium mb-1">
                      {filesQueue.length > 0 
                        ? `${filesQueue.length} files selected` 
                        : "Click or drag files here"}
                    </p>
                    <p className="text-sm text-gray-400">
                      {filesQueue.length > 0 
                        ? `${(filesQueue.reduce((sum, qf) => sum + qf.file.size, 0) / (1024 * 1024 * 1024)).toFixed(2)} GB total`
                        : "Supports multiple files, up to 2GB each"}
                    </p>
                  </div>
                  
                  {filesQueue.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-900/50 p-4 border border-gray-700">
                      <div className="space-y-2">
                        {filesQueue.map((qf, i) => (
                          <div 
                            key={i} 
                            className={`flex items-center justify-between p-2 rounded-lg ${i === currentFileIndex ? 'bg-blue-900/30 border border-blue-700/50' : 'hover:bg-gray-800/50'}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                                qf.status === 'sent' ? 'bg-green-900/50' :
                                qf.status === 'sending' ? 'bg-blue-900/50 animate-pulse' :
                                qf.status === 'failed' ? 'bg-red-900/50' :
                                'bg-gray-800'
                              }`}>
                                {qf.status === 'sent' ? '✓' :
                                 qf.status === 'sending' ? '⏳' :
                                 qf.status === 'failed' ? '✗' : i + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{qf.file.name}</p>
                                <p className="text-xs text-gray-400">
                                  {(qf.file.size / (1024 * 1024)).toFixed(2)} MB • {qf.speed}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-24 bg-gray-700 rounded-full h-2 overflow-hidden">
                                <div 
                                  className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full transition-all duration-300"
                                  style={{ width: `${qf.progress}%` }}
                                ></div>
                              </div>
                              <span className="text-xs font-bold w-8 text-right">{qf.progress}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Connection Input */}
              <div className="bg-gradient-to-r from-gray-900 to-black p-4 rounded-2xl border border-gray-700">
                <p className="text-sm text-gray-400 mb-3">Connect to Receiver</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Enter Receiver's ID (e.g., ABCD)"
                      value={remotePeerId}
                      onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                      className="w-full bg-gray-800 border border-gray-600 focus:border-blue-500 rounded-xl px-4 py-3 outline-none transition-all font-mono uppercase"
                      maxLength={10}
                    />
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-500">
                      {remotePeerId.length}/10
                    </div>
                  </div>
                  <button
                    onClick={connectToPeer}
                    disabled={!remotePeerId.trim()}
                    className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3 rounded-xl font-bold shadow-lg transition-all min-w-[120px]"
                  >
                    {isConnected ? 'Connected ✓' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Progress Section */}
              {(overallProgress > 0 || filesQueue.length > 0) && (
                <div className="space-y-4 animate-slideUp">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">
                        {overallProgress < 100 ? 'Transferring...' : 'Complete!'}
                      </p>
                      <p className="text-sm text-gray-400">
                        File {currentFileIndex + 1} of {filesQueue.length} • ETA: {estimatedTime}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-400 font-mono">{transferSpeed}</p>
                      <p className="text-xs text-gray-400">Current Speed</p>
                    </div>
                  </div>
                  
                  {/* Overall Progress */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Overall Progress</span>
                      <span className="font-bold">{overallProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden relative">
                      <div
                        className="bg-gradient-to-r from-blue-500 via-cyan-400 to-green-400 h-full transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
                        style={{ width: `${overallProgress}%` }}
                      ></div>
                      {overallProgress > 0 && overallProgress < 100 && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer"></div>
                      )}
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={sendAllFiles}
                      disabled={filesQueue.length === 0 || !isConnected || overallProgress > 0}
                      className="flex-1 bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400 disabled:opacity-50 py-4 rounded-xl font-bold shadow-xl text-lg transition-all flex items-center justify-center gap-3"
                    >
                      <span>🚀</span>
                      <span>LAUNCH TRANSFER</span>
                    </button>
                    
                    {overallProgress > 0 && overallProgress < 100 && (
                      <button
                        onClick={cancelTransfer}
                        className="px-6 bg-gradient-to-r from-red-600 to-pink-500 hover:from-red-500 hover:to-pink-400 py-4 rounded-xl font-bold shadow-lg transition-all"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RECEIVE Tab */}
          {activeTab === Tab.RECEIVE && (
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center">
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-300 to-pink-300">
                  Ready to Receive Files
                </h2>
                <p className="text-gray-400 mt-2">
                  Share your ID: <span className="text-yellow-300 font-mono font-bold text-lg">{myPeerId}</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Others can send files by connecting to this ID
                </p>
              </div>

              {/* Transfer Status */}
              {receivedFileMeta ? (
                <div className="bg-gradient-to-br from-gray-900 to-black p-6 rounded-2xl border border-white/10 shadow-2xl">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-bold text-lg text-blue-300 flex items-center gap-2">
                        <span>📄</span>
                        {receivedFileMeta.name}
                      </p>
                      <p className="text-sm text-gray-400">
                        {(receivedFileMeta.size / (1024 * 1024)).toFixed(2)} MB • {receivedFileMeta.type}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-bold font-mono ${transferSpeed.includes('⚡') ? 'text-cyan-400 animate-pulse' : 'text-green-400'}`}>
                        {transferSpeed}
                      </p>
                      <p className="text-xs text-gray-400">ETA: {estimatedTime}</p>
                    </div>
                  </div>

                  {/* Progress Visualization */}
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Receiving Progress</span>
                      <span className="font-bold">{receiverProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-5 overflow-hidden relative">
                      <div
                        className="bg-gradient-to-r from-green-500 via-emerald-400 to-teal-400 h-full transition-all duration-300 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                        style={{ width: `${receiverProgress}%` }}
                      ></div>
                      {receiverProgress > 0 && receiverProgress < 100 && (
                        <div className="absolute top-0 left-0 right-0 bottom-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                      )}
                    </div>
                    
                    {/* Progress Details */}
                    <div className="grid grid-cols-3 gap-4 text-center pt-4">
                      <div className="bg-gray-800/50 p-3 rounded-xl">
                        <div className="text-2xl font-bold text-blue-300">
                          {receiverProgress}%
                        </div>
                        <div className="text-xs text-gray-400">Progress</div>
                      </div>
                      <div className="bg-gray-800/50 p-3 rounded-xl">
                        <div className="text-2xl font-bold text-cyan-300">
                          {(bytesReceivedRef.current / (1024 * 1024)).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-400">MB Received</div>
                      </div>
                      <div className="bg-gray-800/50 p-3 rounded-xl">
                        <div className="text-2xl font-bold text-yellow-300">
                          {maxSpeed.toFixed(1)}
                        </div>
                        <div className="text-xs text-gray-400">Max MB/s</div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-6 space-y-3">
                    {!isMotorReady && !isTransferComplete && (
                      <button
                        onClick={prepareMotor}
                        className="w-full bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-500 hover:to-emerald-400 px-4 py-4 rounded-xl font-bold shadow-xl flex items-center justify-center gap-3 text-lg transition-all"
                      >
                        <span className="text-2xl">⚡</span>
                        <span>ENABLE MOTOR MODE (Direct Save)</span>
                      </button>
                    )}

                    {isTransferComplete && !writableStreamRef.current && !isFileSaved && (
                      <div className="space-y-3">
                        <button
                          onClick={handleSaveFile}
                          className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 py-4 rounded-xl font-bold shadow-xl text-lg transition-all flex items-center justify-center gap-3"
                        >
                          <span>💾</span>
                          <span>SAVE FILE TO DEVICE</span>
                        </button>
                        <p className="text-xs text-gray-400 text-center">
                          The file is temporarily stored in memory. Save it permanently.
                        </p>
                      </div>
                    )}

                    {isTransferComplete && (writableStreamRef.current || isFileSaved) && (
                      <div className="p-4 bg-gradient-to-r from-cyan-900/30 to-teal-900/30 border border-cyan-700 rounded-2xl text-center">
                        <div className="text-4xl mb-2">🎉</div>
                        <p className="text-cyan-300 font-bold text-lg">File Successfully Saved!</p>
                        <p className="text-sm text-cyan-400 mt-1">
                          {writableStreamRef.current ? 'Saved directly to disk via Motor Mode' : 'Downloaded to your device'}
                        </p>
                        <div className="mt-4 flex gap-3 justify-center">
                          <button
                            onClick={() => {
                              if (receivedFiles.length > 0) {
                                const latestFile = receivedFiles[receivedFiles.length - 1];
                                window.open(latestFile.url, '_blank');
                              }
                            }}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm"
                          >
                            Open File
                          </button>
                          <button
                            onClick={resetTransfer}
                            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm"
                          >
                            Ready for Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Waiting State */
                <div className="text-center py-12">
                  <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-3xl flex items-center justify-center text-5xl animate-pulse">
                    ⏳
                  </div>
                  <h3 className="text-xl font-semibold text-gray-300">Waiting for Connection</h3>
                  <p className="text-gray-500 mt-2 max-w-md mx-auto">
                    Share your Device ID with the sender. Once they connect, the file transfer will begin automatically.
                  </p>
                  <div className="mt-6 inline-flex items-center gap-2 text-sm text-gray-400">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span>Ready to receive</span>
                  </div>
                </div>
              )}

              {/* Received Files History */}
              {receivedFiles.length > 0 && (
                <div className="mt-8 pt-6 border-t border-white/10">
                  <h4 className="font-semibold mb-4 flex items-center gap-2">
                    <span>📚</span>
                    <span>Recently Received Files</span>
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {receivedFiles.slice().reverse().map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-xl hover:bg-gray-800/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-lg flex items-center justify-center">
                            📄
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{file.meta.name}</p>
                            <p className="text-xs text-gray-400">
                              {(file.meta.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => window.open(file.url, '_blank')}
                          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors"
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Features Grid */}
        <div className="w-full max-w-4xl mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-800/30 backdrop-blur-sm p-5 rounded-2xl border border-white/5">
            <div className="text-3xl mb-3">⚡</div>
            <h4 className="font-bold mb-2">Ultra-Fast Transfer</h4>
            <p className="text-sm text-gray-400">Optimized engine with 128KB chunks for maximum speed</p>
          </div>
          <div className="bg-gray-800/30 backdrop-blur-sm p-5 rounded-2xl border border-white/5">
            <div className="text-3xl mb-3">🔒</div>
            <h4 className="font-bold mb-2">Secure Connection</h4>
            <p className="text-sm text-gray-400">Peer-to-peer encrypted transfer, no servers involved</p>
          </div>
          <div className="bg-gray-800/30 backdrop-blur-sm p-5 rounded-2xl border border-white/5">
            <div className="text-3xl mb-3">💾</div>
            <h4 className="font-bold mb-2">Motor Mode</h4>
            <p className="text-sm text-gray-400">Direct disk streaming to save memory</p>
          </div>
        </div>
      </main>

      {/* Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="w-16 h-16 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-2xl shadow-2xl flex items-center justify-center text-white text-2xl hover:scale-105 transition-transform hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
          >
            💬
          </button>
        )}

        {isChatOpen && (
          <div className="w-[380px] h-[600px] flex flex-col relative animate-slideUp">
            <button
              onClick={() => setIsChatOpen(false)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-gray-800 hover:bg-gray-700 text-white rounded-full flex items-center justify-center shadow-lg z-10 border border-gray-700 transition-colors"
            >
              ✕
            </button>
            <ChatBot />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 mt-12 py-6">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-500 text-sm">
            SecureShare Pro • P2P File Transfer • v2.0 • {new Date().getFullYear()}
          </p>
          <p className="text-gray-600 text-xs mt-2">
            All transfers are direct between devices. No files are stored on our servers.
          </p>
        </div>
      </footer>

      {/* Custom CSS for animations */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
        
        .animate-slideUp {
          animation: slideUp 0.3s ease-out;
        }
        
        .animate-slideDown {
          animation: slideDown 0.3s ease-out;
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out;
        }
        
        .bg-gradient-radial {
          background-image: radial-gradient(circle, var(--tw-gradient-stops));
        }
      `}</style>
    </div>
  );
};

export default App;

code sahi hai na
