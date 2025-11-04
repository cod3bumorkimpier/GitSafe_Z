pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CodeRepository is ZamaEthereumConfig {
    struct EncryptedCode {
        string codeId;
        string branch;
        euint32 encryptedContent;
        uint256 commitTimestamp;
        address committer;
        bool isLocked;
        uint32 decryptedContent;
        bool isDecrypted;
    }

    mapping(string => EncryptedCode) public encryptedCodes;
    mapping(string => bool) public branchLocks;
    
    string[] public codeIds;
    string[] public branches;

    event CodeCommitted(string indexed codeId, string indexed branch, address indexed committer);
    event BranchLocked(string indexed branch);
    event BranchUnlocked(string indexed branch);
    event CodeDecrypted(string indexed codeId, uint32 decryptedContent);

    constructor() ZamaEthereumConfig() {
    }

    function commitCode(
        string calldata codeId,
        string calldata branch,
        externalEuint32 encryptedContent,
        bytes calldata inputProof
    ) external {
        require(bytes(encryptedCodes[codeId].codeId).length == 0, "Code ID already exists");
        require(!branchLocks[branch], "Branch is locked");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, inputProof)), "Invalid encrypted input");

        encryptedCodes[codeId] = EncryptedCode({
            codeId: codeId,
            branch: branch,
            encryptedContent: FHE.fromExternal(encryptedContent, inputProof),
            commitTimestamp: block.timestamp,
            committer: msg.sender,
            isLocked: false,
            decryptedContent: 0,
            isDecrypted: false
        });

        FHE.allowThis(encryptedCodes[codeId].encryptedContent);
        FHE.makePubliclyDecryptable(encryptedCodes[codeId].encryptedContent);

        codeIds.push(codeId);
        if (!isBranchRegistered(branch)) {
            branches.push(branch);
        }

        emit CodeCommitted(codeId, branch, msg.sender);
    }

    function lockBranch(string calldata branch) external {
        require(!branchLocks[branch], "Branch already locked");
        branchLocks[branch] = true;
        emit BranchLocked(branch);
    }

    function unlockBranch(string calldata branch) external {
        require(branchLocks[branch], "Branch not locked");
        branchLocks[branch] = false;
        emit BranchUnlocked(branch);
    }

    function decryptCode(
        string calldata codeId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(encryptedCodes[codeId].codeId).length > 0, "Code does not exist");
        require(!encryptedCodes[codeId].isDecrypted, "Code already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedCodes[codeId].encryptedContent);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        encryptedCodes[codeId].decryptedContent = decodedValue;
        encryptedCodes[codeId].isDecrypted = true;

        emit CodeDecrypted(codeId, decodedValue);
    }

    function getEncryptedContent(string calldata codeId) external view returns (euint32) {
        require(bytes(encryptedCodes[codeId].codeId).length > 0, "Code does not exist");
        return encryptedCodes[codeId].encryptedContent;
    }

    function getCodeDetails(string calldata codeId) external view returns (
        string memory branch,
        uint256 commitTimestamp,
        address committer,
        bool isLocked,
        bool isDecrypted,
        uint32 decryptedContent
    ) {
        require(bytes(encryptedCodes[codeId].codeId).length > 0, "Code does not exist");
        EncryptedCode storage code = encryptedCodes[codeId];

        return (
            code.branch,
            code.commitTimestamp,
            code.committer,
            code.isLocked,
            code.isDecrypted,
            code.decryptedContent
        );
    }

    function getAllCodeIds() external view returns (string[] memory) {
        return codeIds;
    }

    function getAllBranches() external view returns (string[] memory) {
        return branches;
    }

    function isBranchRegistered(string memory branch) internal view returns (bool) {
        for (uint i = 0; i < branches.length; i++) {
            if (keccak256(bytes(branches[i])) == keccak256(bytes(branch))) {
                return true;
            }
        }
        return false;
    }
}


