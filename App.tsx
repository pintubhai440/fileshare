import React, { useState, useEffect, useRef } from 'react';
import { Tab } from './types';
import { ChatBot } from './components/ChatBot';
import Peer, { DataConnection } from 'peerjs';
import { supabase } from './services/lib/supabase';

// Interfaces
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
  const [transferMode, setTransferMode] = useState<'p2p' | 'cloud' | 'google-drive'>('p2p');
  
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
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Cloud State (Supabase & Google Drive)
  const [cloudLink, setCloudLink] = useState<string | null>(null);
  const [isUploadingCloud, setIsUploadingCloud] = useState(false);
  
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

  // Receiver Buffer State
  const writeBufferRef = useRef<Uint8Array[]>([]);
  const bufferSizeRef = useRef(0);
  const DISK_FLUSH_THRESHOLD = 15 * 1024 * 1024; // 15MB buffer

  // ✅ UPDATED: Screen Wake Lock aur PeerJS Initialization
  useEffect(() => {
    // 🔥 IMPROVED: Screen Wake Lock (Optimized for mobile)
    const keepScreenAwake = async () => {
      // केवल तभी रिक्वेस्ट करें जब पेज visible हो
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          await (navigator as any).wakeLock.request('screen');
        } catch (err) {
          console.log("Wake Lock blocked");
        }
      }
    };
    keepScreenAwake();
    document.addEventListener('visibilitychange', keepScreenAwake);

    // PeerJS Initialization (Only for P2P mode)
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const peer = new Peer(shortId, {
      debug: 0,
      pingInterval: 5000,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject",
          }
        ]
      }
    });

    peer.on('open', (id) => {
      setMyPeerId(id);
      setConnectionStatus('Ready to Connect');
    });

    peer.on('connection', (conn) => {
      if (transferMode === 'p2p') {
        connRef.current = conn;
        setConnectionStatus(`Connected to ${conn.peer}`);
        setupReceiverEvents(conn);
      }
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      
      if (err.type === 'network' || err.type === 'peer-unavailable') {
        setConnectionStatus('Reconnecting...');
        setTimeout(() => {
          if (peer.disconnected) peer.reconnect();
        }, 1000);
      } else {
        setConnectionStatus(`Error: ${err.type}`);
      }
    });

    peerRef.current = peer;

    // Mobile Fix: Handle visibility change for PeerJS
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("App came to foreground, checking connection...");
        
        if (peer.disconnected && transferMode === 'p2p') {
          console.log("Connection lost in background. Reconnecting...");
          setConnectionStatus('Reconnecting...');
          peer.reconnect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', keepScreenAwake);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      peer.destroy();
    };
  }, [transferMode]);

  // 🔥 NEW: Retry Connection Function
  const retryConnection = () => {
    if (peerRef.current && transferMode === 'p2p') {
      setConnectionStatus('Reconnecting...');
      peerRef.current.reconnect();
    }
  };

  // --- RECEIVER LOGIC ---
  const setupReceiverEvents = (conn: DataConnection) => {
    writeBufferRef.current = [];
    bufferSizeRef.current = 0;
    
    conn.on('open', () => {
      setConnectionStatus(`Connected securely to ${conn.peer}`);
      if (conn.dataChannel) {
        conn.dataChannel.binaryType = 'arraybuffer';
      }
    });
    
    conn.on('data', async (data: any) => {
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;
      
      if (isBinary) {
        const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
        
        if (writableStreamRef.current) {
          writeBufferRef.current.push(chunk);
          bufferSizeRef.current += chunk.byteLength;
          bytesReceivedRef.current += chunk.byteLength;

          if (bufferSizeRef.current >= DISK_FLUSH_THRESHOLD) {
            const bigBlob = new Blob(writeBufferRef.current);
            writeBufferRef.current = [];
            bufferSizeRef.current = 0;
            await writableStreamRef.current.write(bigBlob);
          }
        } else {
          chunksRef.current.push(chunk);
          bytesReceivedRef.current += chunk.byteLength;
        }
        
        const now = Date.now();
        if (now - lastUpdateRef.current > 1000) {
          updateProgress();
        }
      } 
      else if (data.type === 'meta') {
        setIsProcessingFile(true);
        receivedFileMetaRef.current = data.meta;
        setReceivedFileMeta(data.meta);
        
        chunksRef.current = [];
        bytesReceivedRef.current = 0;
        lastBytesRef.current = 0;
        lastUpdateRef.current = Date.now();
        
        writeBufferRef.current = [];
        bufferSizeRef.current = 0;
        
        setIsTransferComplete(false);
        setIsMotorReady(false); 
        setIsFileSaved(false);
        setTransferProgress(0);
        setTransferSpeed('Waiting for confirmation...');
        
        transferStatsRef.current = {
          startTime: Date.now(),
          totalBytes: 0,
          peakSpeed: 0,
          averageSpeed: 0
        };
        
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
        }
      } 
      else if (data.type === 'end') {
        if (writableStreamRef.current && writeBufferRef.current.length > 0) {
          const bigBlob = new Blob(writeBufferRef.current);
          writeBufferRef.current = [];
          bufferSizeRef.current = 0;
          await writableStreamRef.current.write(bigBlob);
        }
        
        if (writableStreamRef.current) {
          await writableStreamRef.current.close();
          writableStreamRef.current = null;
          setIsFileSaved(true);
        }
        setTransferProgress(100);
        setTransferSpeed('Completed');
        setIsTransferComplete(true);
        setIsProcessingFile(false);

        const totalTime = (Date.now() - transferStatsRef.current.startTime) / 1000;
        const avgSpeed = (bytesReceivedRef.current / totalTime) / (1024 * 1024);
        transferStatsRef.current.averageSpeed = avgSpeed;
        
        conn.send({ type: 'transfer_complete_ack' });
      }
      else if (data.type === 'ready_to_receive') {
        // Sender is ready
      }
      else if (data.type === 'file_complete') {
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
      } catch (err) {
        console.log("User cancelled file save dialog");
        setTransferSpeed('Save cancelled (Using Fallback)');
        setIsMotorReady(true);
        connRef.current.send({ type: 'ready_to_receive' });
      }
    } else {
      setIsMotorReady(true);
      connRef.current.send({ type: 'ready_to_receive' });
      setTransferSpeed('Ready (Auto-Save Mode)');
    }
  };

  // Progress update function
  const updateProgress = () => {
    if (!receivedFileMetaRef.current) return;
    
    const now = Date.now();
    if (now - lastUpdateRef.current < 1000) return;
    
    const total = receivedFileMetaRef.current.size;
    const percent = Math.min(100, Math.round((bytesReceivedRef.current / total) * 100));
    const bytesDiff = bytesReceivedRef.current - lastBytesRef.current;
    const timeDiff = (now - lastUpdateRef.current) / 1000;
    
    if (timeDiff > 0) {
      const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
      setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
      
      if (speedMBps > transferStatsRef.current.peakSpeed) {
        transferStatsRef.current.peakSpeed = speedMBps;
      }
      
      transferStatsRef.current.totalBytes = bytesReceivedRef.current;
    }
    
    setTransferProgress(percent);
    
    lastUpdateRef.current = now;
    lastBytesRef.current = bytesReceivedRef.current;
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

  // ✅ FIX: Simple File Select (No Splitting Here)
  // हम फाइल को यहाँ नहीं काटेंगे। पूरी फाइल 'uploadToGoogleDrive' फंक्शन को देंगे
  // ताकि वो फोल्डर और नोटबुक सही से बना सके।
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      
      // कोई "Processed Queue" नहीं, सीधे फाइल भेजो
      setFilesQueue(prev => [...prev, ...selectedFiles]);
      
      setCurrentFileIndex(0);
      setTransferProgress(0);
      setTransferSpeed('Ready to Create Workspace & Upload'); 
      setCloudLink(null);
    }
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current) return;
    
    setConnectionStatus('Connecting...');
    
    const conn = peerRef.current.connect(remotePeerId.toUpperCase(), {
      reliable: false 
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
    
    processFileQueue(0);
  };

  // Recursive Queue Processor with Acknowledgment Wait
  const processFileQueue = (index: number) => {
    if (index >= filesQueue.length) {
      setTransferSpeed('All Files Sent Successfully! 🎉');
      return;
    }

    const file = filesQueue[index];
    setCurrentFileIndex(index);
    const conn = connRef.current!;

    console.log(`Starting file ${index + 1}: ${file.name}`);

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

    const handleTransferStep = (data: any) => {
      if (data.type === 'ready_to_receive') {
        console.log("Receiver ready, pumping data...");
        startPumping(conn, file);
      }
      else if (data.type === 'transfer_complete_ack') {
        console.log("Receiver confirmed save. Moving to next file...");
        conn.off('data', handleTransferStep);
        
        setTimeout(() => {
          processFileQueue(index + 1);
        }, 500);
      }
    };

    conn.on('data', handleTransferStep);
  };

  // 🔥 AGGRESSIVE SPEED ENGINE with BEST SETTINGS
  const startPumping = (conn: DataConnection, file: File) => {
    const CHUNK_SIZE = 256 * 1024;
    const MAX_BUFFERED_AMOUNT = 64 * 1024 * 1024;
    const DRAIN_THRESHOLD = 8 * 1024 * 1024;
    const POLLING_INTERVAL = 5;

    const fileReader = new FileReader();
    let offset = 0;
    lastUpdateRef.current = Date.now();
    lastBytesRef.current = 0;

    const waitForDrain = () => {
      if (conn.dataChannel.bufferedAmount < DRAIN_THRESHOLD) {
        readNextChunk();
      } else {
        setTimeout(waitForDrain, POLLING_INTERVAL);
      }
    };

    fileReader.onload = (e) => {
      if (!e.target?.result) return;
      const buffer = e.target.result as ArrayBuffer;
      
      try {
        conn.send(buffer);
        offset += buffer.byteLength;

        const now = Date.now();
        if (now - lastUpdateRef.current > 500) {
          const progress = Math.min(100, Math.round((offset / file.size) * 100));
          const bytesDiff = offset - lastBytesRef.current;
          const timeDiff = (now - lastUpdateRef.current) / 1000;
          if (timeDiff > 0) {
            const speedMBps = (bytesDiff / timeDiff) / (1024 * 1024);
            setTransferSpeed(`${speedMBps.toFixed(1)} MB/s`);
          }
          setTransferProgress(progress);
          lastUpdateRef.current = now;
          lastBytesRef.current = offset;
        }

        if (offset < file.size) {
          if (conn.dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
            readNextChunk();
          } else {
            waitForDrain();
          }
        } else {
          console.log("Data sent, sending END signal...");
          conn.send({ type: 'end' });
          setTransferProgress(100);
          setTransferSpeed('Waiting for save confirmation...');
        }
      } catch (err) {
        console.error("Error sending, retrying...", err);
        setTimeout(readNextChunk, 50);
      }
    };

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    readNextChunk();
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
      const droppedFiles = Array.from(e.dataTransfer.files);
      setFilesQueue(prev => [...prev, ...droppedFiles]);
    }
  };

  // Clear files queue
  const clearFilesQueue = () => {
    setFilesQueue([]);
    setCurrentFileIndex(0);
    setTransferProgress(0);
    setTransferSpeed('0.0 MB/s');
    setCloudLink(null);
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

  // 🧠 GENERATE MAGIC NOTEBOOK (यह Python कोड Google Colab में चलेगा)
  const createColabNotebook = (fileName: string, totalParts: number) => {
    const notebookContent = {
      "nbformat": 4,
      "nbformat_minor": 0,
      "metadata": {
        "colab": { "name": `Merge_${fileName}`, "provenance": [] },
        "kernelspec": { "name": "python3", "display_name": "Python 3" }
      },
      "cells": [
        {
          "cell_type": "markdown",
          "metadata": {},
          "source": [
            `# 🚀 **Auto-Assembler for ${fileName}**\n`,
            "Click the **Play Button** below to merge your file instantly! 👇"
          ]
        },
        {
          "cell_type": "code",
          "execution_count": null,
          "metadata": {},
          "outputs": [],
          "source": [
            "# 1. Mount Google Drive\n",
            "from google.colab import drive\n",
            "drive.mount('/content/drive')\n\n",
            
            "# 2. Merge Files\n",
            "import os\n",
            // ✅ FIXED: Shared_Uploads हटा दिया ताकि सीधे My Drive में ढूंढे
            `folder_path = '/content/drive/My Drive/${fileName}_Folder'\n`,
            `output_file = '/content/drive/My Drive/${fileName}'\n\n`,
            
            "print('⏳ Merging files... Please wait.')\n",
            `os.system(f'cat \"{folder_path}/{fileName}.part\"* > \"{output_file}\"')\n\n`,
            
            "print('✅ SUCCESS! File merged successfully.')\n",
            "print(f'📁 You can find {fileName} in your Google Drive root folder.')"
          ]
        }
      ]
    };
    return new Blob([JSON.stringify(notebookContent)], { type: 'application/json' });
  };

  // 🔥 MAIN UPLOAD FUNCTION (Folder + Split + Notebook)
  const uploadToGoogleDrive = async () => {
    if (filesQueue.length === 0) return;
    
    setIsUploadingCloud(true);
    setTransferProgress(0);

    try {
      const file = filesQueue[0]; // Main file (Assuming single large file for this mode)
      
      // 1. Create a Unique Folder for this Upload
      setTransferSpeed('Creating Workspace Folder...');
      const folderName = `${file.name.replace(/\s/g, '_')}_Folder`; // e.g. GTA5_Folder
      
      const folderRes = await fetch('/api/upload-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, isFolder: true })
      });
      const { id: folderId } = await folderRes.json();

      // 2. Split Logic (Same as before)
      const SPLIT_SIZE = 1000 * 1024 * 1024; // 1GB
      const totalParts = Math.ceil(file.size / SPLIT_SIZE);
      const parts: File[] = [];

      for (let i = 0; i < totalParts; i++) {
        const start = i * SPLIT_SIZE;
        const end = Math.min(file.size, start + SPLIT_SIZE);
        const chunk = file.slice(start, end);
        parts.push(new File([chunk], `${file.name}.part${i + 1}`, { type: 'application/octet-stream' }));
      }

      // 3. Upload All Parts to that Folder (Parallel)
      // ✅ IMPROVED: Better Message for Parallel Upload (No flickering)
      setTransferSpeed(`Uploading ${totalParts} parts in parallel... 🚀`);
      const uploadedBytesPerPart = new Array(parts.length).fill(0);
      const totalSize = file.size;

      const uploadPromises = parts.map(async (part, index) => {
        // Get Link (Targeting the Folder)
        const authResponse = await fetch('/api/upload-to-drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            name: part.name, 
            type: part.type,
            folderId: folderId // 🔥 Upload INSIDE the folder
          })
        });
        const { uploadUrl } = await authResponse.json();

        // Upload
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            xhr.upload.onprogress = (e) => {
              uploadedBytesPerPart[index] = e.loaded;
              const totalUploaded = uploadedBytesPerPart.reduce((a, b) => a + b, 0);
              const percent = Math.round((totalUploaded / totalSize) * 100);
              setTransferProgress(percent);
              // ✅ IMPROVED: Single message for parallel upload
              setTransferSpeed(`Uploading ${totalParts} parts in parallel... 🚀 ${percent}%`);
            };
            xhr.onload = () => resolve("OK");
            xhr.onerror = () => reject();
            xhr.send(part);
        });
      });

      await Promise.all(uploadPromises);

      // 4. Upload the Magic Notebook
      setTransferSpeed('Generating Auto-Assembler... 🤖');
      const notebookBlob = createColabNotebook(file.name, totalParts);
      const notebookFile = new File([notebookBlob], `Merge_${file.name}.ipynb`, { type: 'application/json' });

      // Upload Notebook to SAME folder
      const nbAuth = await fetch('/api/upload-to-drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: notebookFile.name, type: 'application/json', folderId: folderId })
      });
      const { uploadUrl: nbUrl } = await nbAuth.json();
      
      // We need the FINAL VIEW LINK for the Notebook
      const notebookLink = await new Promise<string>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', nbUrl, true);
          xhr.onload = () => {
             const result = JSON.parse(xhr.responseText);
             // Colab link format:
             resolve(`https://colab.research.google.com/drive/${result.id}`);
          };
          xhr.send(notebookFile);
      });

      setTransferSpeed('Setup Complete! 🎉');
      setTransferProgress(100);
      setCloudLink(notebookLink); // Give User the Colab Link

    } catch (err: any) {
      console.error(err);
      setTransferSpeed('Error: ' + err.message);
      alert('Error: ' + err.message);
    } finally {
      setIsUploadingCloud(false);
    }
  };

  // 🔥 EXISTING: Supabase Cloud Upload Function
  const uploadToSupabase = async () => {
    if (!supabase) {
      alert("Supabase is not configured! Check Vercel Environment Variables.");
      return;
    }
    if (filesQueue.length === 0) return;

    setIsUploadingCloud(true);
    setTransferSpeed('Starting Upload...');
    
    try {
      const file = filesQueue[0];
      const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;

      const { data, error } = await supabase.storage
        .from('shared-files')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: (progress) => {
             const percent = (progress.loaded / progress.total) * 100;
             setTransferProgress(Math.round(percent));
             setTransferSpeed('Uploading to Cloud... ☁️');
          }
        });

      if (error) throw error;

      const { data: publicUrlData } = supabase.storage
        .from('shared-files')
        .getPublicUrl(fileName);

      setCloudLink(publicUrlData.publicUrl);
      setTransferSpeed('Upload Complete! Share the link below.');
      setTransferProgress(100);

    } catch (err: any) {
      console.error(err);
      setTransferSpeed('Upload Failed: ' + err.message);
      alert('Upload Error: ' + err.message);
    } finally {
      setIsUploadingCloud(false);
    }
  };

  // Unified Cloud Upload Handler
  const handleCloudUpload = async () => {
    if (transferMode === 'google-drive') {
      await uploadToGoogleDrive();
    } else if (transferMode === 'cloud') {
      await uploadToSupabase();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white relative selection:bg-cyan-500/30">
      {/* Background Effects */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/10 backdrop-blur-md bg-gray-900/50 sticky top-0">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-xl">⚡</span>
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-gray-400">
              TurboShare AI Pro
            </span>
          </div>
          
          {/* Smart Status Bar with Retry Button */}
          <div className="flex items-center gap-2">
            {connectionStatus.toLowerCase().includes('error') && transferMode === 'p2p' && (
              <button 
                onClick={retryConnection}
                className="bg-red-500 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-full font-bold animate-pulse transition-colors"
              >
                🔄 Retry
              </button>
            )}
            
            {transferMode === 'p2p' && (
              <div className="text-xs bg-gray-800/80 backdrop-blur px-3 py-1.5 rounded-full border border-gray-700 flex items-center gap-2 shadow-sm">
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus.includes('Connected') ? 'bg-green-500 animate-pulse' : 
                  connectionStatus.includes('Error') ? 'bg-red-500' : 'bg-yellow-500'
                }`}></div>
                <span className="text-gray-300">Status:</span>
                <span className={`font-mono font-medium ${
                  connectionStatus.includes('Connected') ? 'text-green-400' : 
                  connectionStatus.includes('Error') ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  {connectionStatus}
                </span>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center pb-32">
        
        {/* Tab Switcher */}
        <div className="bg-gray-800/50 p-1 rounded-xl inline-flex mb-8 shadow-lg border border-gray-700 backdrop-blur-sm">
          <button
            onClick={() => setActiveTab(Tab.SEND)}
            className={`px-8 py-3 rounded-lg transition-all duration-300 ${activeTab === Tab.SEND ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            📤 I want to SEND
          </button>
          <button
            onClick={() => setActiveTab(Tab.RECEIVE)}
            className={`px-8 py-3 rounded-lg transition-all duration-300 ${activeTab === Tab.RECEIVE ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            📥 I want to RECEIVE
          </button>
        </div>

        {/* MODE SWITCHER */}
        <div className="flex items-center gap-2 mb-6 bg-gray-900/80 p-2 rounded-full border border-gray-700">
           <button 
             onClick={() => setTransferMode('p2p')}
             className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${transferMode === 'p2p' ? 'bg-green-500 text-black' : 'text-gray-400'}`}
           >
             ⚡ Direct P2P
           </button>
           <button 
             onClick={() => setTransferMode('cloud')}
             className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${transferMode === 'cloud' ? 'bg-blue-500 text-white' : 'text-gray-400'}`}
           >
             ☁️ Supabase
           </button>
           <button 
             onClick={() => setTransferMode('google-drive')}
             className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${transferMode === 'google-drive' ? 'bg-red-500 text-white' : 'text-gray-400'}`}
           >
             📁 Google Drive
           </button>
        </div>

        {/* Device ID Display (Only for P2P mode) */}
        {transferMode === 'p2p' && (
          <div className="mb-8 text-center">
            <p className="text-gray-400 text-sm mb-2">Your Device ID (Share this)</p>
            <div className="flex items-center gap-3 justify-center">
              <div className="text-4xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-500 tracking-widest bg-black/30 px-8 py-4 rounded-2xl border border-yellow-500/20 select-all shadow-[0_0_30px_rgba(234,179,8,0.1)]">
                {myPeerId || '...'}
              </div>
              <button
                onClick={copyPeerId}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white p-4 rounded-xl border border-gray-700 transition-all hover:scale-105 active:scale-95"
                title="Copy to clipboard"
              >
                📋
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-3">Share this ID with the other person to connect</p>
          </div>
        )}

        {/* Main Panel */}
        <div className="w-full max-w-2xl bg-gray-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
            {/* Absolute glow effect inside panel */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
            
            {activeTab === Tab.SEND && (
                <div className="space-y-6">
                  {/* File Picker Area */}
                  <div 
                    className="border-2 border-dashed border-gray-700 rounded-2xl p-10 text-center relative hover:border-blue-500 hover:bg-blue-500/5 transition-all duration-300 group-hover:shadow-[0_0_50px_rgba(59,130,246,0.1)]"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    />
                    <div className="space-y-4 pointer-events-none relative z-10">
                      <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300 shadow-xl">
                        <span className="text-4xl">📁</span>
                      </div>
                      <div>
                        <p className="text-xl font-semibold text-gray-200">
                          {filesQueue.length > 0 
                            ? `${filesQueue.length} files selected` 
                            : "Drop files here or click to browse"}
                        </p>
                        <p className="text-sm text-gray-500 mt-2">Supports videos, images, docs & large files</p>
                      </div>
                    </div>
                    
                    {/* File List Preview */}
                    {filesQueue.length > 0 && (
                      <div className="mt-6 pt-4 border-t border-gray-700/50 text-left">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Queue</span>
                            <button onClick={clearFilesQueue} className="text-xs text-red-400 hover:text-red-300 transition-colors">Clear All</button>
                        </div>
                        <div className="max-h-40 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                            {filesQueue.map((f, i) => (
                                <div key={i} className={`flex items-center justify-between p-2.5 rounded-lg text-sm ${i === currentFileIndex ? 'bg-blue-500/20 border border-blue-500/30' : 'bg-gray-800/50'}`}>
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <span className="text-lg">{i === currentFileIndex ? '▶️' : '📄'}</span>
                                        <span className="truncate text-gray-300">{f.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-xs text-gray-500 font-mono">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                                        <button onClick={(e) => { e.stopPropagation(); removeFileFromQueue(i); }} className="text-gray-500 hover:text-red-400 p-1">✕</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Transfer Controls based on Mode */}
                  {transferMode === 'p2p' ? (
                     /* P2P UI */
                     <div className="space-y-4">
                       {/* Connect Input */}
                       <div className="flex gap-2 p-1.5 bg-gray-950/50 rounded-xl border border-gray-800 focus-within:border-blue-500/50 transition-colors">
                         <input 
                             type="text" 
                             value={remotePeerId}
                             onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
                             placeholder="ENTER RECEIVER ID"
                             className="flex-1 bg-transparent px-4 py-3 outline-none font-mono text-white placeholder-gray-600 uppercase tracking-wider"
                         />
                         <button 
                             onClick={connectToPeer}
                             className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-lg shadow-blue-600/20"
                         >
                             Connect
                         </button>
                       </div>

                       {/* Progress & Send */}
                       {transferProgress > 0 && (
                         <div className="space-y-2">
                             <div className="flex justify-between text-xs font-medium">
                                 <span className="text-blue-400">Transferring file {currentFileIndex + 1}/{filesQueue.length}</span>
                                 <span className="text-green-400 font-mono">{transferSpeed}</span>
                             </div>
                             <div className="h-3 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
                                 <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300 relative" style={{ width: `${transferProgress}%` }}>
                                     <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
                                 </div>
                             </div>
                         </div>
                       )}

                       <button
                         onClick={sendAllFiles}
                         disabled={filesQueue.length === 0 || !connectionStatus.includes('Connected')}
                         className="w-full bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-blue-500/30 transition-all transform active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                       >
                         🚀 SEND ALL FILES
                       </button>
                     </div>
                  ) : (
                     /* Cloud UI */
                     <div className="space-y-4 animate-fade-in">
                       <button 
                         onClick={handleCloudUpload} 
                         disabled={filesQueue.length === 0 || isUploadingCloud}
                         className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all ${isUploadingCloud ? 'bg-gray-700 cursor-wait' : transferMode === 'google-drive' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-500'}`}
                       >
                         {isUploadingCloud 
                           ? 'Uploading...' 
                           : transferMode === 'google-drive' 
                             ? `📁 UPLOAD TO GOOGLE DRIVE (Auto-Assembler)` 
                             : '☁️ UPLOAD TO SUPABASE'}
                       </button>

                       {/* Progress Bar for Cloud */}
                       {isUploadingCloud && (
                         <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-blue-300">
                                {transferMode === 'google-drive' ? 'Creating Workspace... 🚀' : 'Uploading...'}
                              </span>
                              <span className="text-green-300">{transferProgress}%</span>
                            </div>
                            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all" style={{ width: `${transferProgress}%` }}>
                                {transferMode === 'google-drive' && (
                                  <div className="absolute inset-0 bg-white/20 animate-[shimmer_1.5s_infinite]"></div>
                                )}
                              </div>
                            </div>
                            <div className="text-center text-xs text-gray-400">
                              {transferSpeed}
                            </div>
                         </div>
                       )}

                       {/* Result Link - UPDATED WITH COLAB NOTEBOOK LINK */}
                       {cloudLink && (
                         <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-center animate-fade-in">
                           {transferMode === 'google-drive' ? (
                             <>
                               <p className="text-green-400 font-bold mb-2">✅ Auto-Assembler Created!</p>
                               <p className="text-xs text-gray-400 mb-2">Click the link below to open Colab Notebook:</p>
                               <a 
                                 href={cloudLink}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="inline-block w-full bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white py-3 rounded-lg font-bold text-lg transition-all shadow-lg hover:shadow-xl"
                               >
                                 🚀 Open Google Colab Notebook
                               </a>
                               <p className="text-xs text-gray-500 mt-2">
                                 This notebook will automatically merge your file parts in Google Drive
                               </p>
                             </>
                           ) : (
                             <>
                               <p className="text-green-400 font-bold mb-2">✅ File Uploaded!</p>
                               <p className="text-xs text-gray-400 mb-2">Copy your download link below:</p>
                               <div className="relative group">
                                 <textarea 
                                   readOnly 
                                   value={cloudLink}
                                   rows={3}
                                   className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 select-all resize-none focus:border-green-500 outline-none custom-scrollbar whitespace-pre"
                                 />
                                 <button 
                                   onClick={() => {
                                     navigator.clipboard.writeText(cloudLink);
                                     alert("Link copied!");
                                   }} 
                                   className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 p-2 rounded-md transition-colors shadow-lg"
                                   title="Copy Link"
                                 >
                                   📋
                                 </button>
                               </div>
                             </>
                           )}
                         </div>
                       )}
                     </div>
                  )}
                </div>
            )}

            {activeTab === Tab.RECEIVE && (
                <div className="space-y-8 text-center py-4">
                    {transferMode === 'p2p' ? (
                       /* P2P Receive UI */
                       <div>
                         <h2 className="text-2xl font-bold text-white mb-2">P2P Receive Mode</h2>
                         <p className="text-gray-400">Your ID: <span className="text-yellow-400 font-mono font-bold tracking-wider">{myPeerId}</span></p>

                         {receivedFileMeta ? (
                             <div className="mt-4 bg-gray-800/50 p-6 rounded-2xl border border-gray-700/50 animate-fade-in">
                                 <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">
                                     ⬇️
                                 </div>
                                 <h3 className="text-lg font-semibold text-blue-200 mb-1">{receivedFileMeta.name}</h3>
                                 <p className="text-sm text-gray-500 mb-6 font-mono">{(receivedFileMeta.size / 1024 / 1024).toFixed(2)} MB</p>

                                 <div className="space-y-2 mb-6">
                                     <div className="flex justify-between text-xs text-gray-400">
                                         <span>Receiving...</span>
                                         <span className="text-green-400 font-mono">{transferSpeed}</span>
                                     </div>
                                     <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                         <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${transferProgress}%` }}></div>
                                     </div>
                                 </div>

                                 {!isMotorReady && !isTransferComplete && (
                                     <button onClick={prepareMotor} className="w-full bg-green-600 hover:bg-green-500 py-3 rounded-xl font-bold text-white shadow-lg shadow-green-500/20 transition-all flex items-center justify-center gap-2 animate-bounce">
                                         <span>⚡</span> Enable High-Speed Save
                                     </button>
                                 )}

                                 {isTransferComplete && (
                                     <div className="space-y-3">
                                         {!writableStreamRef.current && !isFileSaved && (
                                             <button onClick={handleSaveFile} className="w-full bg-purple-600 hover:bg-purple-500 py-3 rounded-xl font-bold text-white shadow-lg transition-all">
                                                 💾 Save File
                                             </button>
                                         )}
                                         <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm font-medium">
                                             ✨ File Transfer Complete!
                                         </div>
                                     </div>
                                 )}
                             </div>
                         ) : (
                             <div className="py-12 border-2 border-dashed border-gray-800 rounded-2xl">
                                 <div className="animate-pulse text-4xl mb-4">📡</div>
                                 <p className="text-gray-500 font-medium">Waiting for incoming connection...</p>
                             </div>
                         )}
                       </div>
                    ) : (
                       /* Cloud Receive UI */
                       <div className="animate-fade-in">
                         <h2 className="text-2xl font-bold text-white mb-4">Cloud Download</h2>
                         <p className="text-gray-400 text-sm mb-6">Paste the link shared by the sender to download instantly.</p>
                         <input 
                           type="text" 
                           placeholder="Paste Link Here..." 
                           className="w-full bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-white mb-4 focus:border-blue-500 outline-none" 
                           onChange={(e) => { if(e.target.value) window.open(e.target.value, '_blank'); }}
                         />
                         <p className="text-xs text-gray-500">Note: Clicking the link will start the download in your browser immediately.</p>
                       </div>
                    )}
                </div>
            )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center text-gray-600 text-xs py-6 border-t border-white/5">
        <p>TurboShare AI Pro • Secured by WebRTC • P2P & Cloud Support</p>
      </footer>

      {/* Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="w-14 h-14 bg-blue-600 hover:bg-blue-500 rounded-full shadow-2xl shadow-blue-600/40 flex items-center justify-center text-white text-2xl transition-transform hover:scale-110 active:scale-95"
          >
            💬
          </button>
        )}

        {isChatOpen && (
          <div className="w-[350px] h-[500px] flex flex-col relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
            <div className="bg-gray-800 p-3 flex justify-between items-center border-b border-gray-700">
                <span className="font-bold text-sm">AI Assistant</span>
                <button onClick={() => setIsChatOpen(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatBot />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
