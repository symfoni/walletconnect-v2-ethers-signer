import WalletConnectClient, { CLIENT_EVENTS } from '@walletconnect/client';
import { AppMetadata, PairingTypes, SessionTypes } from '@walletconnect/types';
import { Bytes, ethers, Signer } from 'ethers';
import { Deferrable } from 'ethers/lib/utils';

type RPCConfig =
  | string
  | {
      [chainId: number]: string;
    }
  | { infuraId: string };

interface WalletConnectWeb3ProviderOptions {
  rpcConfig: RPCConfig;
  relayProvider: string;
  chainId: number;
  metadata: AppMetadata;
  methods: string[];
  blockchain: string;
}

const DEFAULT = {
  RPC_URL: 'http://localhost:8545',
  RELAY_PROVIDER: 'wss://relay.walletconnect.org',
  CHAIN_ID: 1,
  metadata: {
    name: 'Some dApp',
    description: 'Some example dApp',
    url: 'https://walletconnect.org/',
    icons: [
      'https://gblobscdn.gitbook.com/spaces%2F-LJJeCjcLrr53DcT1Ml7%2Favatar.png?alt=media',
    ],
  },
  methods: [
    'eth_sendTransaction',
    'personal_sign',
    'eth_signTypedData',
    'eth_signTransaction',
  ],
  blockchain: 'eip155',
};

export class WalletConnectSigner extends Signer {
  walletConnectClient: Promise<WalletConnectClient>;
  uri: Promise<string>;
  accounts?: Array<string>;
  listener: Promise<void>;
  options: WalletConnectWeb3ProviderOptions;
  provider?: ethers.providers.Provider;

  constructor(
    _options: Partial<WalletConnectWeb3ProviderOptions> = {},
    provider?: ethers.providers.Provider,
  ) {
    super();
    this.options = {
      relayProvider: DEFAULT.RELAY_PROVIDER,
      chainId: DEFAULT.CHAIN_ID,
      rpcConfig: DEFAULT.RPC_URL,
      metadata: DEFAULT.metadata,
      methods: DEFAULT.methods,
      blockchain: DEFAULT.blockchain,
      ..._options,
    };
    this.walletConnectClient = WalletConnectClient.init({
      relayProvider: this.options.relayProvider,
      logger: 'warn',
    });
    this.listener = this.listen();
    this.uri = this.getURI();
    if (provider) {
      this.provider = provider;
    }
  }

  private async getURI() {
    return new Promise<string>((resolve) => {
      this.walletConnectClient.then((wc) => {
        console.log('Wallet connect listening for URI');
        wc.on(
          CLIENT_EVENTS.pairing.proposal,
          async (proposal: PairingTypes.Proposal) => {
            console.log('CLIENT_EVENTS.pairing.proposal');
            const { uri } = proposal.signal.params;
            resolve(uri);
          },
        );
      });
    });
  }

  enable = async () => {
    await this.walletConnectClient;
    const session = await this.createSession();
    this.updateState(session);
    return this.accounts;
  };

  createSession = async () => {
    const wc = await this.walletConnectClient;

    // Do we need to create a new session
    const sessions = wc.session.values;
    if (sessions.length > 0) {
      try {
        // TODO: Find out which session is last and check if its not expired
        const selectedSession = sessions[0];
        await wc.session.settled.set(selectedSession.topic, selectedSession, {
          relay: selectedSession.relay,
        });
        const session = await wc.session.get(sessions[0].topic);
        return session;
      } catch (error) {
        console.log('Couldt not set old session, creating new');
      }
    }
    const { metadata, chainId, blockchain } = this.options;

    return await wc.connect({
      metadata,
      permissions: {
        blockchain: {
          chains: [`${blockchain}:${chainId}`],
        },
        jsonrpc: {
          methods: this.options.methods,
        },
      },
    });
  };

  private listen = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      this.walletConnectClient.then((wc) => {
        console.log('WalletConnect signer listening');
        // Sessions
        wc.on(
          CLIENT_EVENTS.session.updated,
          async (session: SessionTypes.Settled) => {
            console.debug('CLIENT_EVENTS.session.updated', session);
            this.updateState(session);
          },
        );
        wc.on(
          CLIENT_EVENTS.session.created,
          (session: SessionTypes.Settled) => {
            console.debug('CLIENT_EVENTS.session.created', session);
          },
        );
        wc.on(
          CLIENT_EVENTS.session.deleted,
          (session: SessionTypes.Settled) => {
            console.debug('CLIENT_EVENTS.session.deleted', session);
          },
        );

        // Pairing
        wc.on(
          CLIENT_EVENTS.pairing.updated,
          async (pairing: PairingTypes.Settled) => {
            console.debug('CLIENT_EVENTS.pairing.updated', pairing);
          },
        );
        wc.on(
          CLIENT_EVENTS.pairing.created,
          async (pairing: PairingTypes.Settled) => {
            console.debug('CLIENT_EVENTS.pairing.created', pairing);
          },
        );
        wc.on(
          CLIENT_EVENTS.pairing.deleted,
          async (pairing: PairingTypes.Settled) => {
            console.debug('CLIENT_EVENTS.pairing.deleted', pairing);
          },
        );
        wc.on('modal_closed', () => {
          reject('User closed modal');
        });
        wc.on('disconnect', () => {
          setTimeout(() => {
            console.log('disconnect disconnect disconnect');

            resolve();
          }, 1000);
        });
      });
    });
  };

  async updateState(session: SessionTypes.Settled) {
    const { accounts } = session.state;
    // Check if accounts changed and trigger event
    if (!this.accounts || (accounts && this.accounts !== accounts)) {
      this.accounts = accounts;
      if (this.provider) {
        this.provider.emit('accountsChanged', accounts);
      }
    }
    // TODO chainChanged, networkChanged, rpcChanged, BlockchainChanged? :D
  }

  // private getRPCUrl() {
  //   const _chainId = this.options.chainId;
  //   if (typeof this.options.rpcConfig === 'string') {
  //     return this.options.rpcConfig;
  //   }
  //   if ('infuraId' in this.options.rpcConfig) {
  //     const infuraNetwork: InfuraNetworks = INFURA_NETWORKS;

  //     if (!Object.prototype.hasOwnProperty.call(infuraNetwork, _chainId)) {
  //       throw Error(
  //         'Infura network has not be configured by WalletConnectWeb3Provider for chainId' +
  //           this.options.chainId,
  //       );
  //     }
  //     const network = infuraNetwork[_chainId];
  //     return `https://${network}.infura.io/v3/${this.options.rpcConfig.infuraId}`;
  //   }
  //   if (
  //     !Object.prototype.hasOwnProperty.call(this.options.rpcConfig, _chainId)
  //   ) {
  //     throw Error('Please set an RPC for chainID' + this.options.chainId);
  //   }
  //   return this.options.rpcConfig[_chainId];
  // }

  // Returns the checksum address

  async getAddress() {
    if (!this.accounts) {
      throw Error(
        'walletConnectClient must be enabled before you can list accounts.',
      );
    }
    return this.accounts[0].split('@')[0];
  }

  // Returns the signed prefixed-message. This MUST treat:
  // - Bytes as a binary message
  // - string as a UTF8-message
  // i.e. "0x1234" is a SIX (6) byte string, NOT 2 bytes of data
  async signMessage(message: Bytes | string): Promise<string> {
    const wc = await this.walletConnectClient;
    const address = await this.getAddress();
    const res = await wc.request({
      request: {
        method: 'personal_sign',
        params: [message, address],
      },
      topic: wc.session.topics[0],
    });
    return res as string;
  }

  // Signs a transaxction and returns the fully serialized, signed transaction.
  // The EXACT transaction MUST be signed, and NO additional properties to be added.
  // - This MAY throw if signing transactions is not supports, but if
  //   it does, sentTransaction MUST be overridden.
  async signTransaction(
    transaction: Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<string> {
    const wc = await this.walletConnectClient;
    const res = await wc.request({
      request: {
        method: 'eth_signTransaction',
        params: [transaction],
      },
      topic: wc.session.topics[0],
    });
    return res as string;
  }

  // Returns a new instance of the Signer, connected to provider.
  // This MAY throw if changing providers is not supported.
  connect(provider: ethers.providers.Provider): WalletConnectSigner {
    return new WalletConnectSigner(this.options, provider);
  }

  async close() {
    const wc = await this.walletConnectClient;
    wc.events.emit('disconnect');
    await this.listener;
    await Promise.all(
      wc.pairing.topics.map((topic) => {
        return wc.disconnect({
          topic: topic,
          reason: {
            code: 123,
            message: 'Test ended',
          },
        });
      }),
    );
    await Promise.all(
      wc.session.topics.map((topic) => {
        return wc.disconnect({
          topic: topic,
          reason: {
            code: 123,
            message: 'Test ended',
          },
        });
      }),
    );

    delete (this as any).walletConnectClient;
    delete (this as any).uri;
    delete (this as any).accounts;

    delete (this as any).provider;
    return true;
  }
}
