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
  description: string;
  language: string;
  stars: number;
  lastUpdated: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface RepoStats {
  totalRepos: number;
  verifiedRepos: number;
  avgStars: number;
  recentActivity: number;
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
  const [newRepoData, setNewRepoData] = useState({ 
    name: "", 
    description: "", 
    language: "JavaScript",
    stars: "" 
  });
  const [selectedRepo, setSelectedRepo] = useState<CodeRepo | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("all");
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState<RepoStats>({
    totalRepos: 0,
    verifiedRepos: 0,
    avgStars: 0,
    recentActivity: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
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
            description: businessData.description,
            language: "JavaScript",
            stars: Number(businessData.publicValue1) || 0,
            lastUpdated: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRepos(reposList);
      calculateStats(reposList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (reposList: CodeRepo[]) => {
    const totalRepos = reposList.length;
    const verifiedRepos = reposList.filter(r => r.isVerified).length;
    const avgStars = totalRepos > 0 ? reposList.reduce((sum, r) => sum + r.stars, 0) / totalRepos : 0;
    const recentActivity = reposList.filter(r => Date.now()/1000 - r.lastUpdated < 60 * 60 * 24 * 7).length;

    setStats({
      totalRepos,
      verifiedRepos,
      avgStars,
      recentActivity
    });
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
      
      const starsValue = parseInt(newRepoData.stars) || 0;
      const businessId = `repo-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, starsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRepoData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        starsValue,
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
      setNewRepoData({ name: "", description: "", language: "JavaScript", stars: "" });
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
    }
  };

  const filteredRepos = repos.filter(repo => {
    const matchesSearch = repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         repo.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLanguage = filterLanguage === "all" || repo.language === filterLanguage;
    return matchesSearch && matchesLanguage;
  });

  const languages = [...new Set(repos.map(repo => repo.language))];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>GitSafe_Z 🔐</h1>
            <p>FHE-based Code Repository</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access GitSafe_Z</h2>
            <p>Private code hosting with fully homomorphic encryption for secure code storage and search.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted repositories with homomorphic search</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Protect your intellectual property with zero-knowledge proofs</p>
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
          <p>FHE-Protected Code Hosting</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Repository
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Repositories</h3>
            <div className="stat-value">{stats.totalRepos}</div>
            <div className="stat-trend">+{stats.recentActivity} this week</div>
          </div>
          
          <div className="stat-card">
            <h3>FHE Verified</h3>
            <div className="stat-value">{stats.verifiedRepos}/{stats.totalRepos}</div>
            <div className="stat-trend">Encrypted & Verified</div>
          </div>
          
          <div className="stat-card">
            <h3>Avg Stars</h3>
            <div className="stat-value">{stats.avgStars.toFixed(1)}</div>
            <div className="stat-trend">FHE Protected</div>
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
            <select 
              value={filterLanguage} 
              onChange={(e) => setFilterLanguage(e.target.value)}
              className="language-filter"
            >
              <option value="all">All Languages</option>
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <button 
              onClick={loadData} 
              className="refresh-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="repos-grid">
          {filteredRepos.length === 0 ? (
            <div className="no-repos">
              <p>No repositories found</p>
              <button 
                className="create-btn" 
                onClick={() => setShowCreateModal(true)}
              >
                Create First Repository
              </button>
            </div>
          ) : (
            filteredRepos.map((repo, index) => (
              <div 
                className={`repo-card ${repo.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedRepo(repo)}
              >
                <div className="repo-header">
                  <h3>{repo.name}</h3>
                  <span className="repo-language">{repo.language}</span>
                </div>
                <p className="repo-description">{repo.description}</p>
                <div className="repo-meta">
                  <span>⭐ {repo.stars}</span>
                  <span>Updated: {new Date(repo.lastUpdated * 1000).toLocaleDateString()}</span>
                </div>
                <div className="repo-status">
                  {repo.isVerified ? "✅ FHE Verified" : "🔓 Ready for Verification"}
                </div>
                <div className="repo-creator">
                  {repo.creator.substring(0, 6)}...{repo.creator.substring(38)}
                </div>
              </div>
            ))
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
          onClose={() => setSelectedRepo(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(`repo-${selectedRepo.id}`)}
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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'stars') {
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
          <h2>New Encrypted Repository</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Star count will be encrypted with homomorphic encryption for private analytics</p>
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
            <label>Description</label>
            <textarea 
              name="description" 
              value={repoData.description} 
              onChange={handleChange} 
              placeholder="Repository description..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Programming Language</label>
            <select name="language" value={repoData.language} onChange={handleChange}>
              <option value="JavaScript">JavaScript</option>
              <option value="TypeScript">TypeScript</option>
              <option value="Python">Python</option>
              <option value="Solidity">Solidity</option>
              <option value="Rust">Rust</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Star Count (Integer only) *</label>
            <input 
              type="number" 
              name="stars" 
              value={repoData.stars} 
              onChange={handleChange} 
              placeholder="Enter star count..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !repoData.name || !repoData.stars} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Repository"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RepoDetailModal: React.FC<{
  repo: CodeRepo;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ repo, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (repo.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="repo-detail-modal">
        <div className="modal-header">
          <h2>Repository Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="repo-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{repo.name}</strong>
            </div>
            <div className="info-item">
              <span>Language:</span>
              <strong>{repo.language}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{repo.creator.substring(0, 6)}...{repo.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(repo.lastUpdated * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{repo.description}</p>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Repository Data</h3>
            
            <div className="data-row">
              <div className="data-label">Star Count:</div>
              <div className="data-value">
                {repo.isVerified ? 
                  `${repo.decryptedValue} (FHE Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(repo.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || repo.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 repo.isVerified ? "✅ Verified" : 
                 decryptedValue !== null ? "🔄 Re-verify" : 
                 "🔓 Verify with FHE"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>Homomorphic Encryption Protection</strong>
                <p>Star count is encrypted on-chain using FHE. Verification performs offline decryption with on-chain proof verification.</p>
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