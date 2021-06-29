import fetch from 'node-fetch';
import * as log from 'loglevel';
import * as fs from 'fs';

import { registerFetch, registerLogger } from 'conseiljs';

import { TezosNodeReader, TezosNodeWriter, TezosConseilClient, TezosConstants, TezosParameterFormat, TezosMessageUtils, KeyStore, Signer } from 'conseiljs';
import { KeyStoreUtils, SoftSigner } from 'conseiljs-softsigner';

const logger = log.getLogger('conseiljs');
logger.setLevel('debug', false);
registerLogger(logger);
registerFetch(fetch);

const tezosNode = '';
const conseilServer = { url: '', apiKey: '', network: 'florencenet' };
const networkBlockTime = 60 + 1;

function clearRPCOperationGroupHash(hash: string) {
    return hash.replace(/\"/g, '').replace(/\n/, '');
}

async function initAccount(server: string, accountKey: string): Promise<{keyStore: KeyStore, signer: Signer, counter: number}> {
    const keyStore = await KeyStoreUtils.restoreIdentityFromSecretKey(accountKey);
    const signer = await SoftSigner.createSigner(TezosMessageUtils.writeKeyWithHint(keyStore.secretKey, 'edsk'));
    const counter = await TezosNodeReader.getCounterForAccount(server, keyStore.publicKeyHash) + 1;

    return { keyStore, signer, counter };
}

async function deployTokenContract(signer: Signer, keyStore: KeyStore) {
    console.log('deploying token contract');
    const code = fs.readFileSync('contracts/btctz.micheline', 'utf8');
    const storage = `{ "prim": "Pair", "args": [ { "prim": "Pair", "args": [ { "string": "${keyStore.publicKeyHash}" }, { "prim": "Pair", "args": [ { "int": "0" }, [] ] } ] }, { "prim": "Pair", "args": [ { "prim": "Pair", "args": [ { "prim": "Unit" }, [] ] }, { "prim": "Pair", "args": [ { "prim": "False" }, [] ] } ] } ] }`;

    const r = await TezosNodeWriter.sendContractOriginationOperation(tezosNode, signer, keyStore, 0, undefined, 0, 0, 0, code, storage, TezosParameterFormat.Micheline, TezosConstants.HeadBranchOffset, true);

    const groupid = clearRPCOperationGroupHash(r.operationGroupID);
    console.log(`injected operation ${groupid}`);
    const s = await TezosConseilClient.awaitOperationConfirmation(conseilServer, conseilServer.network, groupid, 7, networkBlockTime);
    console.log(`deployed ${s['originated_contracts']} in ${s['block_hash']}`);
    return s['originated_contracts'];
}

async function mintMinimumBalance(signer: Signer, keyStore: KeyStore, contractAddress: string, targetAdmin: string) {
    console.log(`minting minimum balance future admin ${targetAdmin}`);

    const minTokenBalance = 1;
    const params = `{ "prim": "Left", "args": [ { "prim": "Right", "args": [ { "prim": "Left", "args": [ { "prim": "Pair", "args": [ { "prim": "Pair", "args": [ { "string": "${targetAdmin}" }, { "prim": "Pair", "args": [ { "int": "${minTokenBalance}" }, { "int": "8" } ] } ] }, { "prim": "Pair", "args": [ { "string": "Token 0" }, { "prim": "Pair", "args": [ { "string": "TK0" }, { "int": "0" } ] } ] } ] } ] } ] } ] }`;

    const r = await TezosNodeWriter.sendContractInvocationOperation(tezosNode, signer, keyStore, contractAddress, 0, 0, 0, 0, 'default', params, TezosParameterFormat.Micheline, TezosConstants.HeadBranchOffset, true);

    const groupid = clearRPCOperationGroupHash(r.operationGroupID);
    console.log(`injected operation ${groupid}`);
    const s = await TezosConseilClient.awaitOperationConfirmation(conseilServer, conseilServer.network, groupid, 7, networkBlockTime);
    console.log(`completed in ${s['block_hash']}`);
}

async function transferAdminRights(signer: Signer, keyStore: KeyStore, contractAddress: string, targetAdmin: string) {
    console.log(`transferring ownership to ${targetAdmin}`);
    
    const r = await TezosNodeWriter.sendContractInvocationOperation(tezosNode, signer, keyStore, contractAddress, 0, 0, 0, 0, 'set_administrator', `"${targetAdmin}"`, TezosParameterFormat.Michelson, TezosConstants.HeadBranchOffset, true);

    const groupid = clearRPCOperationGroupHash(r.operationGroupID);
    console.log(`injected operation ${groupid}`);
    const s = await TezosConseilClient.awaitOperationConfirmation(conseilServer, conseilServer.network, groupid, 7, networkBlockTime);
    console.log(`completed in ${s['block_hash']}`);
}

async function run() {
    let tokenContract = '';
    let targetAdmin = '';
    const accountInfo = await initAccount(tezosNode, 'edskRoMzzinXTDaBhNcuYvh4eskWLq8iWNWbaMtembAN2ArvwLVwCdye78xu3az8GqaAKfZTnAv6ZbR4TvmvRNeSsoeeQeXAXr'); // test-net sk

    if (tokenContract.length === 0) {
        tokenContract = await deployTokenContract(accountInfo.signer, accountInfo.keyStore);
    }

    await mintMinimumBalance(accountInfo.signer, accountInfo.keyStore, tokenContract, targetAdmin);

    await transferAdminRights(accountInfo.signer, accountInfo.keyStore, tokenContract, targetAdmin);
}

run();
