import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface CodeRepo {
  id: number;
  name: string;
  encryptedSize: string;
  fileCount: string;
  lastUpdated: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  description: string;
}

interface RepoStats {
  totalRepos: number;
  encryptedFiles: number;
  avgFileSize: number;
  activeUsers: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<CodeRepo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRepoData, setNewRepoData] = useState({ name: "", size: "", files: "", description: "" });
  const [selectedRepo, setSelectedRepo] = useState<CodeRepo | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const reposPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const reposList: CodeRepo[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          reposList.push({
            id: parseInt(businessId.replace('repo-', '')) || Date.now(),
            name: businessData.name,
            encryptedSize: businessId,
            fileCount: businessId,
            lastUpdated: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            description: businessData.description
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRepos(reposList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRepo = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRepo(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating repository with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const sizeValue = parseInt(newRepoData.size) || 0;
      const businessId = `repo-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, sizeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRepoData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRepoData.files) || 0,
        0,
        newRepoData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Repository created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRepoData({ name: "", size: "", files: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRepo(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (error) {
      console.error('Availability check failed:', error);
    }
  };

  const filteredRepos = repos.filter(repo => 
    repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const indexOfLastRepo = currentPage * reposPerPage;
  const indexOfFirstRepo = indexOfLastRepo - reposPerPage;
  const currentRepos = filteredRepos.slice(indexOfFirstRepo, indexOfLastRepo);
  const totalPages = Math.ceil(filteredRepos.length / reposPerPage);

  const getRepoStats = (): RepoStats => {
    const totalRepos = repos.length;
    const encryptedFiles = repos.reduce((sum, repo) => sum + repo.publicValue1, 0);
    const avgFileSize = repos.length > 0 ? encryptedFiles / repos.length : 0;
    const uniqueUsers = new Set(repos.map(repo => repo.creator)).size;

    return {
      totalRepos,
      encryptedFiles,
      avgFileSize: Math.round(avgFileSize),
      activeUsers: uniqueUsers
    };
  };

  const stats = getRepoStats();

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>GitSafe_Z 🔐</h1>
            <span>FHE-based Code Repository</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Access GitSafe_Z</h2>
            <p>Secure your code with fully homomorphic encryption. Private repositories with searchable encrypted content.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted repositories with Zama FHE</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Search and manage code with zero-knowledge proofs</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your code repositories</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted repositories...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>GitSafe_Z 🔐</h1>
          <span>FHE-based Code Repository</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check FHE Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Repository
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="dashboard-container">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">📁</div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalRepos}</div>
              <div className="stat-label">Total Repositories</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🔒</div>
            <div className="stat-info">
              <div className="stat-value">{stats.encryptedFiles}</div>
              <div className="stat-label">Encrypted Files</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">👥</div>
            <div className="stat-info">
              <div className="stat-value">{stats.activeUsers}</div>
              <div className="stat-label">Active Users</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <div className="stat-value">{stats.avgFileSize}</div>
              <div className="stat-label">Avg Files/Repo</div>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "↻"}
            </button>
          </div>
        </div>

        <div className="repos-section">
          <div className="section-header">
            <h2>Encrypted Repositories</h2>
            <span className="repo-count">{filteredRepos.length} repositories</span>
          </div>
          
          <div className="repos-list">
            {currentRepos.length === 0 ? (
              <div className="no-repos">
                <p>No repositories found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Repository
                </button>
              </div>
            ) : currentRepos.map((repo, index) => (
              <div 
                className={`repo-item ${selectedRepo?.id === repo.id ? "selected" : ""}`} 
                key={index}
                onClick={() => setSelectedRepo(repo)}
              >
                <div className="repo-header">
                  <div className="repo-name">{repo.name}</div>
                  <div className="repo-status">
                    {repo.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </div>
                </div>
                <div className="repo-description">{repo.description}</div>
                <div className="repo-meta">
                  <span>Files: {repo.publicValue1}</span>
                  <span>Updated: {new Date(repo.lastUpdated * 1000).toLocaleDateString()}</span>
                  {repo.isVerified && repo.decryptedValue && (
                    <span>Size: {repo.decryptedValue} KB</span>
                  )}
                </div>
                <div className="repo-creator">By {repo.creator.substring(0, 6)}...{repo.creator.substring(38)}</div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="page-btn"
              >
                Previous
              </button>
              <span className="page-info">Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="page-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateRepo 
          onSubmit={createRepo} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRepo} 
          repoData={newRepoData} 
          setRepoData={setNewRepoData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRepo && (
        <RepoDetailModal 
          repo={selectedRepo} 
          onClose={() => { 
            setSelectedRepo(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRepo.encryptedSize)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRepo: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  repoData: any;
  setRepoData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, repoData, setRepoData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'size') {
      const intValue = value.replace(/[^\d]/g, '');
      setRepoData({ ...repoData, [name]: intValue });
    } else {
      setRepoData({ ...repoData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-repo-modal">
        <div className="modal-header">
          <h2>Create New Repository</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Repository size will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Repository Name *</label>
            <input 
              type="text" 
              name="name" 
              value={repoData.name} 
              onChange={handleChange} 
              placeholder="Enter repository name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Repository Size (KB, Integer only) *</label>
            <input 
              type="number" 
              name="size" 
              value={repoData.size} 
              onChange={handleChange} 
              placeholder="Enter size in KB..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>File Count *</label>
            <input 
              type="number" 
              min="1" 
              name="files" 
              value={repoData.files} 
              onChange={handleChange} 
              placeholder="Enter file count..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={repoData.description} 
              onChange={handleChange} 
              placeholder="Repository description..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !repoData.name || !repoData.size || !repoData.files} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Repository"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RepoDetailModal: React.FC<{
  repo: CodeRepo;
  onClose: () => void;
  decryptedData: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ repo, onClose, decryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="repo-detail-modal">
        <div className="modal-header">
          <h2>Repository Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="repo-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{repo.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{repo.creator.substring(0, 6)}...{repo.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Last Updated:</span>
              <strong>{new Date(repo.lastUpdated * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>File Count:</span>
              <strong>{repo.publicValue1} files</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{repo.description}</p>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>Repository Size:</span>
                <div className="status-value">
                  {repo.isVerified && repo.decryptedValue ? 
                    `${repo.decryptedValue} KB (Verified)` : 
                    decryptedData !== null ? 
                    `${decryptedData} KB (Decrypted)` : 
                    "🔒 Encrypted"
                  }
                </div>
              </div>
              
              <button 
                className={`decrypt-btn ${(repo.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || repo.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 repo.isVerified ? "✅ Verified" : 
                 decryptedData !== null ? "🔓 Decrypted" : 
                 "🔓 Decrypt Size"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Repository</strong>
                <p>Repository size is encrypted on-chain using Zama FHE. Decryption requires off-chain computation and on-chain verification.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


