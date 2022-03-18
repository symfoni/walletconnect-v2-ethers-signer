/* eslint-disable @typescript-eslint/no-unused-vars */
import { ethers } from 'ethers';
import { SIGNER_EVENTS, WalletConnectSigner } from '../src/index';
import { WalletClient } from '../src/WalletClient';
import { TestNetwork } from 'ethereum-test-network';
import { ERC20Token__factory } from '../__test__utils__/ERC20Token__factory';
import { unlinkSync } from 'fs';

const CHAIN_ID = 123;
const PORT = 8549;
const RPC_URL = `http://localhost:${PORT}`;
const DEFAULT_GENESIS_ACCOUNTS = [
  {
    balance: '0x295BE96E64066972000000',
    privateKey: '0xa3dac6ca0b1c61f5f0a0b3a0acf93c9a52fd94e8e33d243d3b3a8b8c5dc37f0b', // 0xaaE062157B53077da1414ec3579b4CBdF7a4116f
  },
];

const getWalletClient = () => {
  return new WalletClient({
    rpcURL: RPC_URL,
    privateKey: DEFAULT_GENESIS_ACCOUNTS[0].privateKey,
    walletConnectOpts: {
      storageOptions: {
        database: 'test.db',
        tableName: 'wallet_client',
      },
      projectId: '7bce7aed9e29ec53076fac9181c66144',
      logger: 'warn',
    },
    debug: true,
  });
};

const getAppClient = () => {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  return new WalletConnectSigner(
    {
      chainId: CHAIN_ID,
      methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTransaction', 'oracle_data'],
      walletConnectOpts: {
        storageOptions: {
          database: 'test.db',
          tableName: 'app_client',
        },
        logger: 'warn',
      },
      debug: true,
    },
    provider,
  );
};
describe('WalletConnectSigner', () => {
  let testnetwork: TestNetwork;

  afterAll(() => {
    setTimeout(() => {
      try {
        unlinkSync('test.db');
        // eslint-disable-next-line no-empty
      } catch (_) {}
    }, 300);
  });

  beforeEach(async () => {
    testnetwork = await TestNetwork.init({
      chainId: CHAIN_ID,
      port: PORT,
      genesisAccounts: DEFAULT_GENESIS_ACCOUNTS,
    });
  });

  afterEach(async () => {
    await testnetwork.close();
  });

  it('should initiate', async () => {
    jest.setTimeout(30000);
    const walletClient = getWalletClient();
    const walletConnectSigner = getAppClient();
    walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
      return walletClient.pair(uri);
    });
    await walletConnectSigner.open();
    const address = await walletConnectSigner.getAddress();
    await walletClient.close();
    await walletConnectSigner.close();
    expect(address).toContain(new ethers.Wallet(DEFAULT_GENESIS_ACCOUNTS[0].privateKey).address);
  });

  it('should reConnect', async () => {
    jest.setTimeout(30000);
    const walletClient = getWalletClient();
    const walletConnectSigner = getAppClient();
    walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
      return walletClient.pair(uri);
    });
    await walletConnectSigner.open();
    // removed, if we close session it should not reconnect.
    // await walletConnectSigner.close();

    const walletConnectSignerReconnect = getAppClient();
    await walletConnectSignerReconnect.open();
    const address = await walletConnectSignerReconnect.getAddress();
    await walletClient.close();
    await walletConnectSigner.close();
    await walletConnectSignerReconnect.close();
    expect(address).toContain(new ethers.Wallet(DEFAULT_GENESIS_ACCOUNTS[0].privateKey).address);
  });

  // eslint-disable-next-line jest/no-disabled-tests
  it('should deploy erc20', async () => {
    jest.setTimeout(30000);
    const walletClient = getWalletClient();
    const walletConnectSigner = getAppClient();
    walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
      return walletClient.pair(uri);
    });
    await walletConnectSigner.open();
    const address = await walletConnectSigner.getAddress();
    const erc20Factory = new ERC20Token__factory(walletConnectSigner);
    const erc20 = await erc20Factory.deploy('The test token', 'tst', 18);
    await erc20.deployed();
    const balanceToMint = ethers.utils.parseEther('500');
    const mintTx = await erc20.mint(address, balanceToMint);
    await mintTx.wait();
    const tokenBalance = await erc20.balanceOf(address);
    await walletConnectSigner.close();
    await walletClient.close();
    expect(tokenBalance.eq(balanceToMint)).toBeTruthy();
  });

  it('custom request', async () => {
    const walletClient = getWalletClient();
    const walletConnectSigner = getAppClient();
    walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
      return walletClient.pair(uri);
    });
    await walletConnectSigner.open();
    const param = 1;
    const request = await walletConnectSigner.request('oracle_data', [param]);

    expect(request).toContain('success');
    expect(request).toContain(param);
  });

  // it('reinit', async () => {
  //   const walletClient = getWalletClient();
  //   const walletConnectSigner = getAppClient();
  //   walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
  //     return walletClient.pair(uri);
  //   });
  //   await walletConnectSigner.open();
  //   await walletConnectSigner.close();
  //   await new Promise((resolve) => {
  //     setTimeout(() => {
  //       resolve(true);
  //     }, 2000);
  //   });
  //   const request = await walletConnectSigner.request('oracle_data', [param]);
  //   console.log(request);

  //   expect(request).toContain('success');
  //   expect(request).toContain(param);
  // });
});
