/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CLIENT_EVENTS, Client } from '@walletconnect/client';
import {
  ClientOptions,
  IClient,
  PairingTypes,
  SessionTypes,
} from '@walletconnect/types';
import { Bytes, ethers, Signer } from 'ethers';
import { Deferrable } from 'ethers/lib/utils';
import { EventEmitter } from 'events';
import WalletConnectQRCodeModal from '@walletconnect/qrcode-modal';
import { QRCodeModalOptions } from '@walletconnect/qrcode-modal/dist/cjs/types';

export const SIGNER_EVENTS = {
  init: 'signer_init',
  uri: 'signer_uri',
};

export interface WalletConnectSignerOpts {
  chainId?: number;
  qrModal: boolean;
  qrModalOpts: QRCodeModalOptions;
  methods: string[];
  blockchain: string;
  walletConnectOpts: Partial<ClientOptions>;
}

const DEFAULT: WalletConnectSignerOpts = {
  chainId: undefined,
  qrModal: true,
  qrModalOpts: {},
  methods: [
    'eth_sendTransaction',
    'personal_sign',
    'eth_signTypedData',
    'eth_signTransaction',
  ],
  blockchain: 'eip155',
  walletConnectOpts: {
    relayProvider: 'wss://relay.walletconnect.org',
    metadata: {
      name: 'Some dApp',
      description: 'Some example dApp',
      url: 'https://walletconnect.org/',
      icons: [
        'https://gblobscdn.gitbook.com/spaces%2F-LJJeCjcLrr53DcT1Ml7%2Favatar.png?alt=media',
      ],
    },
    controller: false,
  },
};

function isClient(opts?: IClient | ClientOptions): opts is IClient {
  return (
    typeof opts !== 'undefined' &&
    typeof (opts as IClient).context !== 'undefined'
  );
}

export class WalletConnectSigner extends Signer {
  events = new EventEmitter();
  provider?: ethers.providers.Provider;
  client?: IClient;
  initializing = false;
  private accounts?: Array<string>;
  private opts: WalletConnectSignerOpts;
  private pending = false;
  private session: SessionTypes.Settled | undefined;

  constructor(
    _opts: Partial<WalletConnectSignerOpts> = {},
    provider?: ethers.providers.Provider,
  ) {
    super();
    if (_opts.walletConnectOpts) {
      _opts.walletConnectOpts = {
        ...DEFAULT.walletConnectOpts,
        ..._opts.walletConnectOpts,
      };
    }
    this.opts = {
      ...DEFAULT,
      ..._opts,
    };
    this.events = new EventEmitter();
    if (provider) {
      this.provider = provider;
    }
    this.register(this.opts.walletConnectOpts);
  }
  get connected(): boolean {
    return typeof this.session !== 'undefined';
  }

  get connecting(): boolean {
    return this.pending;
  }
  // PUBLIC

  public on(event: string, listener: any): void {
    this.events.on(event, listener);
  }
  public once(event: string, listener: any): void {
    this.events.once(event, listener);
  }
  public removeListener(event: string, listener: any): void {
    this.events.removeListener(event, listener);
  }
  public off(event: string, listener: any): void {
    this.events.off(event, listener);
  }

  // public waitFor(event: string): Promise<any> {
  //   return new Promise((resolve) => {
  //     this.events.once(event, (event) => {
  //       resolve(event);
  //     });
  //   });
  // }
  get isWalletConnect() {
    return true;
  }

  public async getAddress() {
    if (!this.accounts) {
      throw Error('client must be enabled before you can list accounts.');
    }
    return this.accounts[0].split('@')[0];
  }

  // Returns the signed prefixed-message. This MUST treat:
  // - Bytes as a binary message
  // - string as a UTF8-message
  // i.e. "0x1234" is a SIX (6) byte string, NOT 2 bytes of data
  public async signMessage(message: Bytes | string): Promise<string> {
    if (typeof this.client === 'undefined') {
      this.client = await this.register();
      if (!this.connected) await this.open();
    }
    if (typeof this.session === 'undefined') {
      throw new Error('Signer connection is missing session');
    }
    const wc = await this.register();
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
  public async signTransaction(
    transaction: Deferrable<ethers.providers.TransactionRequest>,
  ): Promise<string> {
    if (typeof this.client === 'undefined') {
      this.client = await this.register();
      if (!this.connected) await this.open();
    }
    if (typeof this.session === 'undefined') {
      throw new Error('Signer connection is missing session');
    }
    const res = await this.client.request({
      request: {
        method: 'eth_signTransaction',
        params: [transaction],
      },
      topic: this.session.topic,
    });
    return res as string;
  }

  // Returns a new instance of the Signer, connected to provider.
  // This MAY throw if changing providers is not supported.
  connect(provider: ethers.providers.Provider): WalletConnectSigner {
    return new WalletConnectSigner(this.opts, provider);
  }

  public async open(): Promise<void> {
    this.pending = true;
    const client = await this.register();
    let chainId = undefined;
    if (this.provider) {
      const network = await this.provider.getNetwork();
      chainId = network.chainId;
    } else {
      chainId = this.opts.chainId;
    }
    console.log(chainId);
    if (!chainId) {
      throw Error(
        'WalletConnectSigner must be initialized with a chainId when no provider is connected or the provider is unable to provide chainId.',
      );
    }
    const { blockchain } = this.opts;
    const { metadata } = this.opts.walletConnectOpts;
    this.session = await client.connect({
      metadata,
      permissions: {
        blockchain: {
          chains: [`${blockchain}:${chainId}`],
        },
        jsonrpc: {
          methods: this.opts.methods,
        },
      },
    });
    console.log('got sessions');
    this.onOpen();
  }

  public async close() {
    if (typeof this.session === 'undefined') {
      return;
    }
    const client = await this.register();
    await client.disconnect({
      topic: this.session.topic,
      reason: {
        code: 123,
        message: 'WalletConnectSigner closed.',
      },
    });
    this.onClose();
  }

  // ---------- Private ----------------------------------------------- //

  private async register(opts?: IClient | ClientOptions): Promise<IClient> {
    if (typeof this.client !== 'undefined') {
      return this.client;
    }
    if (this.initializing) {
      return new Promise((resolve, reject) => {
        this.events.once(SIGNER_EVENTS.init, () => {
          if (typeof this.client === 'undefined') {
            return reject(new Error('Client not initialized'));
          }
          resolve(this.client);
        });
      });
    }
    if (isClient(opts)) {
      this.client = opts;
      this.registerEventListeners();
      return this.client;
    }
    this.initializing = true;
    this.client = await Client.init(opts);
    this.initializing = false;
    this.registerEventListeners();
    this.events.emit(SIGNER_EVENTS.init);
    return this.client;
  }

  private onClose() {
    this.pending = false;
    if (this.client) {
      this.client = undefined;
    }
    this.events.emit('close');
  }

  private onOpen(session?: SessionTypes.Settled) {
    this.pending = false;
    if (session) {
      this.session = session;
    }
    this.events.emit('open');
  }

  private async updateState(session: SessionTypes.Settled) {
    const { accounts } = session.state;
    // Check if accounts changed and trigger event
    if (!this.accounts || (accounts && this.accounts !== accounts)) {
      this.accounts = accounts;
      if (this.provider) {
        this.provider.emit('accountsChanged', accounts);
      }
    }
    this.events.emit('stateUpdated', true);
    // TODO chainChanged, networkChanged, rpcChanged, BlockchainChanged? :D
  }

  private registerEventListeners() {
    if (typeof this.client === 'undefined') return;
    console.log('App listening');
    // Sessions
    this.client.on(
      CLIENT_EVENTS.session.updated,
      async (session: SessionTypes.Settled) => {
        console.debug('CLIENT_EVENTS.session.updated');
        if (!this.session || this.session?.topic !== session.topic) return;
        this.session = session;
        this.updateState(session);
      },
    );
    this.client.on(
      CLIENT_EVENTS.session.created,
      (session: SessionTypes.Settled) => {
        console.debug('CLIENT_EVENTS.session.created');
        this.updateState(session);
      },
    );
    this.client.on(
      CLIENT_EVENTS.session.deleted,
      (_session: SessionTypes.Settled) => {
        this.onClose();
      },
    );
    // Pairing
    this.client.on(
      CLIENT_EVENTS.pairing.proposal,
      async (proposal: PairingTypes.Proposal) => {
        console.debug('CLIENT_EVENTS.pairing.proposal');
        const uri = proposal.signal.params.uri;
        this.events.emit(SIGNER_EVENTS.uri, { uri });
        if (this.opts.qrModal) {
          WalletConnectQRCodeModal.open(
            uri,
            () => {
              console.log('Modal open');
            },
            this.opts.qrModalOpts,
          );
        }
      },
    );
    this.client.on(
      CLIENT_EVENTS.pairing.updated,
      async (_pairing: PairingTypes.Settled) => {
        console.debug('CLIENT_EVENTS.pairing.updated');
      },
    );
    this.client.on(
      CLIENT_EVENTS.pairing.created,
      async (_pairing: PairingTypes.Settled) => {
        console.debug('CLIENT_EVENTS.pairing.created');
      },
    );
    this.client.on(
      CLIENT_EVENTS.pairing.deleted,
      async (_pairing: PairingTypes.Settled) => {
        console.debug('CLIENT_EVENTS.pairing.deleted');
      },
    );
  }
}

// async getClient() {
//   if (this.initializing) {
//     return new Promise<WalletConnectClient>((resolve, reject) => {
//       this.events.once('initialized', () => {
//         if (typeof this.client === 'undefined') {
//           reject(new Error('Client not initialized'));
//         }
//         resolve(this.client);
//       });
//     });
//   }

//   this.initializing = true;
//   this.client = await WalletConnectClient.init(this.opts.walletConnectOpts);
//   this.initializing = false;
//   this.events.emit('initialized');
//   return this.client;
// }
