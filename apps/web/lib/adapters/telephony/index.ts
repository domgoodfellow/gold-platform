/**
 * Placing a telephone call, as a capability.
 *
 * **Not a word in here belongs to a vendor**, and `adapters.test.ts` reads this file to
 * hold that from both sides: no domain file may import an implementation, and the contract may
 * not speak a provider's vocabulary. What a caller says is *ring this number into that room*.
 * Which company carries it is `registry.ts`'s only subject.
 *
 * **Three methods, and each arrived with a caller** — which is the bar (nothing is built before it has a caller) and
 * the reason there is no `hold`, no `transfer` and no `merge` here yet. All three are one
 * operation on a participant once the conference-call design's conference exists, and each gets added by the screen
 * that presses the button rather than in advance of one.
 */

/** What the network is doing, normalised. The same six values `calls.status` allows. */
export type CallStatus =
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'busy';

export type PlacedCall = {
  /**
   * The provider's own id for this leg.
   *
   * Kept so a later callback can find the row it belongs to. It is an opaque string here and
   * must stay one — the moment anything above this file parses it, the shape of one vendor's
   * identifiers has become a fact the platform depends on.
   */
  externalId: string;
  status: CallStatus;
};

export type TelephonyProvider = {
  /**
   * Ring `to` from `from`, and put them in the room called `room`.
   *
   * **A room rather than a direct dial, which is the conference-call design.** Both parties join a conference instead
   * of being connected to each other, because hold, transfer, merge and supervision are each
   * one operation on somebody in a room and none of them is possible on a two-party line.
   *
   * Where the carrier reports what happens next is not an argument: the runtime that places the
   * call names its own address, so nobody asking for a call can have its reports sent elsewhere.
   */
  addToRoom(input: {
    room: string;
    from: string;
    to: string;
  }): Promise<PlacedCall>;

  /**
   * A short-lived credential letting one person's browser act as a telephone.
   *
   * **The thing that makes an agent reachable at all.** Without it a call rings a customer and
   * connects them to nobody, which is what the first reception slice actually did.
   *
   * Who the browser is — this person's own membership in this business — is resolved from their
   * session by the runtime that signs the credential, never supplied by a caller. It is minted
   * per session and never stored.
   */
  browserToken(): Promise<string>;

  /**
   * Change what one leg is doing inside a room that already exists — the operation the conference-call design promised
   * once a conference existed: hold, mute, or end this one leg without ending the conference for
   * everybody else in it. One method rather than three, because all three are the same REST
   * shape at the carrier (update one participant) and a caller asks for only the field it means
   * to change.
   */
  updateParticipant(input: {
    room: string;
    externalId: string;
    hold?: boolean;
    muted?: boolean;
    /** Ends this one leg. The conference itself survives — that is the entire point of the conference-call design. */
    status?: 'completed';
    /**
     * Whether this leg leaving closes the room for everybody. The agent who started a call closes
     * it by hanging up; a transfer has to turn that off first, or handing a call over drops it.
     */
    endsRoomOnExit?: boolean;
  }): Promise<void>;

  /**
   * The audio of one call's recording, or `null` when the call has none. Whether this person may
   * play it is checked, under their own session, by the runtime that fetches it; the carrier's
   * reference is never handed to a person, because it is not authorization.
   */
  fetchRecording(input: { callId: string }): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null>;
};

/**
 * Creating the scope a business dials from, as a capability distinct from dialling itself.
 *
 * **Why a second capability rather than a fourth method on `TelephonyProvider`.** Ringing a
 * customer into a room is something every call needs; standing up the subaccount a call happens
 * inside is something one business needs once, done by staff rather than by whoever is on the
 * phone. Folding the two together would mean every caller of `addToRoom` importing a surface it
 * never uses.
 *
 * **Three steps and nothing beyond them**, matching what a subaccount actually needs before a
 * call or a browser token can use it: its own scope, a key to sign a token with later, and
 * an application a browser's outgoing call can be pointed at. Which of these already exist for a
 * retry is `lib/domain/providers/`'s question, not this one's — each method here does the one
 * externally-visible thing its name says and nothing to check first.
 */
/** `signingSecret` is what the carrier signs this scope's reports with. Stored once, never shown. */
export type ProvisionedSubaccount = { sid: string; signingSecret: string };
export type ProvisionedApiKey = { sid: string; secret: string };
export type ProvisionedTwimlApp = { sid: string };

export type TelephonyProvisioner = {
  createSubaccount(input: { friendlyName: string }): Promise<ProvisionedSubaccount>;
  /** The signing secret of a scope that already exists, for a provisioning run that is resuming. */
  subaccountSigningSecret(input: { subaccountSid: string }): Promise<string>;
  createApiKey(input: { subaccountSid: string; friendlyName: string }): Promise<ProvisionedApiKey>;
  createTwimlApp(input: {
    subaccountSid: string;
    friendlyName: string;
    voiceUrl: string;
  }): Promise<ProvisionedTwimlApp>;
};

/**
 * Acting on GOLD's *own* account with the carrier, as a capability distinct from acting inside one
 * business's scope.
 *
 * **Every method reaches the carrier through `apps/api`, never from here.** The credential for a
 * GOLD-owned account is stored in Vault and readable by exactly one machine role that only that
 * runtime can wear; this runtime holds no signing secret and must not. What comes back is
 * an answer, never the credential.
 *
 * `provisioner` is the same three-step contract the deployment-credential path implements, so
 * `lib/domain/providers/` provisions identically whichever way GOLD's account is held.
 */
export type ProviderAccountVerification = {
  ok: boolean;
  error: string | null;
  metadata: Record<string, unknown>;
};

/** One scope the carrier reports beneath GOLD's account. Identifier, name and state, no more. */
export type RemoteSubaccount = {
  sid: string;
  friendlyName: string | null;
  status: string | null;
};

export type TelephonyAccountOperations = {
  verify(): Promise<ProviderAccountVerification>;
  listSubaccounts(): Promise<RemoteSubaccount[]>;
  provisioner: TelephonyProvisioner;
};

/** How a GOLD account may authenticate, named by the capability so a form can offer the choice. */
export type TelephonyCredentialKind = {
  key: string;
  label: string;
  /** The public identifier this mechanism needs beside the secret, or null when it needs none. */
  identifierLabel: string | null;
};

/**
 * Re-exported so domain code imports the capability and nothing deeper.
 *
 * `adapters.test.ts` allows a domain file to import `@/lib/adapters/<capability>` exactly, and
 * refuses any path with a second segment — because reaching past this file is how an
 * implementation's name arrives in the domain layer one import at a time. `./registry` is
 * therefore the single place in the tree, outside an implementation, permitted to name a carrier.
 */
export {
  TELEPHONY_RESOURCE_TYPES,
  callbackBase,
  telephonyAccountOperations,
  telephonyBootstrapConfigured,
  telephonyCredentialKinds,
  telephonyProvider,
  telephonyProviderKey,
  telephonyProvisioner,
  telephonySubaccountName,
  validateTelephonyAccountIdentity,
} from './registry';
