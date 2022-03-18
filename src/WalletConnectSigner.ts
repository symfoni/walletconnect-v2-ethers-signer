/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client, CLIENT_EVENTS } from '@walletconnect/client';
import { ClientOptions, IClient, PairingTypes, SessionTypes } from '@walletconnect/types';
import debug from 'debug';
import { Bytes, ethers, Signer } from 'ethers';
import { Deferrable } from 'ethers/lib/utils';
import { EventEmitter } from 'events';

export const SIGNER_EVENTS = {
  init: 'init',
  uri: 'uri',
  open: 'open',
  close: 'close',
  statusUpdate: 'status_update',
};

export interface WalletConnectSignerOpts {
  chainId?: number;
  methods: string[];
  blockchain: string;
  walletConnectOpts: Partial<ClientOptions>;
  debug: boolean;
}

const DEFAULT: WalletConnectSignerOpts = {
  chainId: undefined,
  methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTransaction'],
  blockchain: 'eip155',
  walletConnectOpts: {
    relayUrl: 'wss://relay.walletconnect.com',
    metadata: {
      name: 'Some dApp',
      description: 'Some example dApp',
      url: 'https://walletconnect.org/',
      icons: ['https://gblobscdn.gitbook.com/spaces%2F-LJJeCjcLrr53DcT1Ml7%2Favatar.png?alt=media'],
    },
    controller: false,
    projectId: '7bce7aed9e29ec53076fac9181c66144',
  },
  debug: false,
};

function isClient(opts?: IClient | ClientOptions): opts is IClient {
  return typeof opts !== 'undefined' && typeof (opts as IClient).context !== 'undefined';
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
  _index: number;
  _address: string;
  private log: debug.Debugger;

  constructor(_opts: Partial<WalletConnectSignerOpts> = {}, provider?: ethers.providers.Provider) {
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

    this.log = debug('WalletconnectSigner');
    this.log.enabled = this.opts.debug ? true : false;
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

  get isWalletConnect() {
    return true;
  }

  // Returns a new instance of the Signer, connected to provider.
  // This MAY throw if changing providers is not supported.
  connect(provider: ethers.providers.Provider): WalletConnectSigner {
    return new WalletConnectSigner(this.opts, provider);
  }

  public async open(opts: { onlyReconnect: boolean } = { onlyReconnect: false }): Promise<void> {
    try {
      this.pending = true;
      const client = await this.register();
      const chainId = await this.getChainId();
      const { blockchain } = this.opts;
      const { metadata } = this.opts.walletConnectOpts;
      const permissions = {
        blockchain: {
          chains: [`${blockchain}:${chainId}`],
        },
        jsonrpc: {
          methods: this.opts.methods,
        },
      };

      const supportedSession = await this.client.session.find(permissions);
      this.log('supportedSession amount: ', supportedSession.length);
      if (supportedSession.length > 0) {
        this.log('reconnecting to session', supportedSession[0].topic);
        this.updateState(supportedSession[0]);
      } else if (!opts.onlyReconnect) {
        const confirmOpen = new Promise((resolve) => {
          this.client.on(CLIENT_EVENTS.session.created, (_: SessionTypes.Settled) => {
            resolve(true);
          });
        });
        await client.connect({
          metadata,
          permissions,
        });
        await confirmOpen;
      } else {
        this.log(`onlyReconnect is ${opts.onlyReconnect} and found no supported sessions`);
      }
      this.onOpen();
    } catch (error) {
      this.log(error);
      throw error;
    }
  }

  public async close() {
    debug('close initiated');
    if (typeof this.session === 'undefined') {
      debug('close requested with no session defined, will not close anything');
      return;
    }
    const client = await this.register();
    const confirmClose = new Promise((resolve) => {
      this.client.on(CLIENT_EVENTS.session.deleted, (_: SessionTypes.Settled) => {
        resolve(true);
      });
    });
    await client.disconnect({
      topic: this.session.topic,
      reason: {
        code: 123,
        message: 'WalletConnectSigner closed.',
      },
    });
    await confirmClose;
    this.onClose();
  }

  public async getAddress() {
    this.log(this.accounts);
    if (!this.accounts) {
      throw Error('client must be enabled before you can list accounts.');
    }
    // return AccountId.parse(this.accounts[0]).address;
    return this.accounts[0].split(':').pop();
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
      throw new Error('Signer connection is missing session for signMessage');
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
  public async signTransaction(transaction: Deferrable<ethers.providers.TransactionRequest>): Promise<string> {
    if (typeof this.client === 'undefined') {
      this.client = await this.register();
      if (!this.connected) await this.open();
    }
    if (typeof this.session === 'undefined') {
      throw new Error('Signer connection is missing session for signTransaction');
    }
    transaction = {
      ...transaction,
      gasLimit: ethers.BigNumber.from(transaction.gasLimit).toHexString(),
      gasPrice: ethers.BigNumber.from(transaction.gasPrice).toHexString(),
    };
    const res = await this.client.request({
      request: {
        method: 'eth_signTransaction',
        params: [transaction],
      },
      topic: this.session.topic,
    });
    return res as string;
  }

  async request(method: string, params: unknown[]) {
    if (typeof this.client === 'undefined') {
      this.client = await this.register();
      if (!this.connected) await this.open();
    }
    if (typeof this.session === 'undefined') {
      throw new Error('Signer connection is missing session for request');
    }
    const res = await this.client.request({
      request: {
        method: method,
        params: params,
      },
      topic: this.session.topic,
    });
    return res as string;
  }

  async getChainId() {
    let chainId = undefined;
    if (this.provider) {
      const network = await this.provider.getNetwork();
      chainId = network.chainId;
    } else {
      chainId = this.opts.chainId;
    }
    if (!chainId) {
      throw Error('WalletConnectSigner must be initialized with a chainId when no provider is connected or the provider is unable to provide chainId.');
    }
    return chainId;
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
    this.events.emit(SIGNER_EVENTS.close);
  }

  private onOpen(session?: SessionTypes.Settled) {
    this.pending = false;
    if (session) {
      this.session = session;
      this.events.emit(SIGNER_EVENTS.open);
    }
  }

  private async updateState(session: SessionTypes.Settled) {
    this.session = session;
    const { accounts } = session.state;
    // Check if accounts changed and trigger event
    if (!this.accounts || (accounts && this.accounts !== accounts)) {
      this.accounts = accounts;
      if (this.provider) {
        this.provider.emit('accountsChanged', accounts);
      }
    }
    this.events.emit(SIGNER_EVENTS.statusUpdate, session);
    // TODO chainChanged, networkChanged, rpcChanged, BlockchainChanged? :D
  }

  // private removeEventListeners() {
  //   if (typeof this.client === 'undefined') return;
  //   this.events.removeAllListeners(CLIENT_EVENTS.session.updated);
  //   this.events.removeAllListeners(CLIENT_EVENTS.session.created);
  //   this.events.removeAllListeners(CLIENT_EVENTS.session.deleted);
  // }
  private registerEventListeners() {
    if (typeof this.client === 'undefined') return;
    // Sessions
    this.client.on(CLIENT_EVENTS.session.updated, async (session: SessionTypes.Settled) => {
      this.log('CLIENT_EVENTS.session.updated');
      if (!this.session || this.session?.topic !== session.topic) return;
      this.updateState(session);
    });
    this.client.on(CLIENT_EVENTS.session.created, (session: SessionTypes.Settled) => {
      this.log('CLIENT_EVENTS.session.created');
      this.updateState(session);
    });
    this.client.on(CLIENT_EVENTS.session.deleted, (_session: SessionTypes.Settled) => {
      this.onClose();
    });
    // Pairing
    this.client.on(CLIENT_EVENTS.pairing.proposal, async (proposal: PairingTypes.Proposal) => {
      this.log('CLIENT_EVENTS.pairing.proposal');
      const uri = proposal.signal.params.uri;
      this.events.emit(SIGNER_EVENTS.uri, uri);
    });
    this.client.on(CLIENT_EVENTS.pairing.updated, async (_pairing: PairingTypes.Settled) => {
      this.log('CLIENT_EVENTS.pairing.updated');
    });
    this.client.on(CLIENT_EVENTS.pairing.created, async (_pairing: PairingTypes.Settled) => {
      this.log('CLIENT_EVENTS.pairing.created');
    });
    this.client.on(CLIENT_EVENTS.pairing.deleted, async (_pairing: PairingTypes.Settled) => {
      this.log('CLIENT_EVENTS.pairing.deleted');
    });
  }
}

// Not implemented function
// connectUnchecked(): WalletConnectSigner {
//   return new WalletConnectSigner(this.opts, this.provider);
// }
// sendUncheckedTransaction(
//   transaction: Deferrable<ethers.providers.TransactionRequest>,
// ): Promise<string> {
//   throw Error('Not implemented');
// }

// async _signTypedData(
//   domain: TypedDataDomain,
//   types: Record<string, Array<ethersTypedDataField>>,
//   value: Record<string, any>,
// ): Promise<string> {
//   throw Error('Not implemented');
// }
// async unlock(password: string): Promise<boolean> {
//   throw Error('Not implemented');
// }
