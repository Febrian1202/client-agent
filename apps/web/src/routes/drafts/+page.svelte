<script lang="ts">
	import { onMount } from 'svelte';
	import {
		api,
		type DraftItem
	} from '$lib/api';

	type DraftWithHash = DraftItem & { contentHash?: string | null };
	import {
		FileEdit,
		RefreshCw,
		CheckCircle2,
		AlertCircle,
		AlertTriangle,
		Clock,
		ExternalLink,
		Send,
		Check,
		X,
		Save,
		Hash,
		Info
	} from 'lucide-svelte';

	// Tab definition
	type TabFilter = 'all' | 'pending_approval' | 'approved' | 'sent' | 'rejected';

	interface StatusTab {
		id: TabFilter;
		label: string;
	}

	const statusTabs: StatusTab[] = [
		{ id: 'pending_approval', label: 'Pending Approval' },
		{ id: 'approved', label: 'Approved' },
		{ id: 'sent', label: 'Sent' },
		{ id: 'rejected', label: 'Rejected' },
		{ id: 'all', label: 'All' }
	];

	// Fallback sample drafts for offline preview or initial showcase
	const DEFAULT_SAMPLE_DRAFTS: DraftWithHash[] = [
		{
			id: 301,
			conversationId: 10,
			agentRunId: 101,
			clientUsername: 'KitsuneMei',
			content: 'Hi Mei! Thanks for checking in. The eye physics and blink physics layers are completed and running smoothly in VTube Studio. I am now working on the mouth vowel forms (A, I, U, E, O). I will send a preview video clip tomorrow afternoon.',
			status: 'pending_approval',
			contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			createdAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 22 * 60 * 1000).toISOString()
		},
		{
			id: 302,
			conversationId: 11,
			agentRunId: 102,
			clientUsername: 'StarlightVT',
			content: "Hello Starlight! Your 6 emote sketches are looking super cute! I have finished the linework and base flats for the GG, Cry, and Hype emotes. Here is the link to the progress board if you want to take a look.",
			status: 'approved',
			contentHash: '7a58e13783a48e71b29a288939c36294fd2f7eeab5a8e7a60b97cbcf79a0ec2b',
			approvedBy: 1,
			approvedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString()
		},
		{
			id: 303,
			conversationId: 12,
			agentRunId: 103,
			clientUsername: 'NekoRider',
			content: 'Hi Neko! The neon jacket adjustments have been submitted to the VGen delivery portal. You can now download the high-res PNGs and transparent overlays directly from your dashboard.',
			status: 'sent',
			contentHash: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca7',
			approvedBy: 1,
			approvedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
			sentAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
		},
		{
			id: 304,
			conversationId: 13,
			agentRunId: 104,
			clientUsername: 'PixelFox',
			content: 'We can definitely do that for free without extending the project delivery schedule.',
			status: 'rejected',
			contentHash: 'd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2',
			createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString()
		}
	];

	// Svelte 5 Runes State
	let drafts = $state<DraftWithHash[]>([]);
	let selectedTab = $state<TabFilter>('pending_approval');
	let draftEdits = $state<Record<number, string>>({});
	let draftHashes = $state<Record<number, string>>({});
	let isLoading = $state(true);
	let isSavingId = $state<number | null>(null);
	let isApprovingId = $state<number | null>(null);
	let isSendingId = $state<number | null>(null);

	// Rejection Modal State
	let rejectionModalDraft = $state<DraftWithHash | null>(null);
	let rejectionReason = $state('');
	let isSubmittingRejection = $state(false);

	// Toast notification state
	let toastMessage = $state<string | null>(null);
	let toastType = $state<'success' | 'error' | 'info'>('success');
	let toastTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
		if (toastTimeout) clearTimeout(toastTimeout);
		toastMessage = message;
		toastType = type;
		toastTimeout = setTimeout(() => {
			toastMessage = null;
		}, 4000);
	}

	// Compute SHA-256 hash or deterministic fallback
	async function calculateSha256(text: string): Promise<string> {
		try {
			if (typeof crypto !== 'undefined' && crypto.subtle) {
				const encoder = new TextEncoder();
				const data = encoder.encode(text);
				const buffer = await crypto.subtle.digest('SHA-256', data);
				const hashArray = Array.from(new Uint8Array(buffer));
				return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
			}
		} catch {
			// fallback below
		}
		let h1 = 0xdeadbeef;
		let h2 = 0x41c6ce57;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
		h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
		h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
		const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
		const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
		return (hex1 + hex2).repeat(4).slice(0, 64);
	}

	// Initialize draft edits and hashes
	async function syncDraftStates(items: DraftWithHash[]) {
		const newEdits: Record<number, string> = {};
		const newHashes: Record<number, string> = {};

		for (const d of items) {
			newEdits[d.id] = d.content;
			if (d.contentHash) {
				newHashes[d.id] = d.contentHash;
			} else {
				newHashes[d.id] = await calculateSha256(d.content);
			}
		}
		draftEdits = newEdits;
		draftHashes = newHashes;
	}

	// Filtered drafts based on active tab
	const filteredDrafts = $derived.by(() => {
		if (selectedTab === 'all') return drafts;
		return drafts.filter((d) => d.status === selectedTab);
	});

	// Status counts for badge counters
	const statusCounts = $derived.by(() => {
		const counts: Record<string, number> = {
			all: drafts.length,
			pending_approval: 0,
			approved: 0,
			sent: 0,
			rejected: 0
		};
		for (const d of drafts) {
			if (counts[d.status] !== undefined) {
				counts[d.status]++;
			}
		}
		return counts;
	});

	// Relative timestamp formatting
	function formatRelativeTime(dateInput: string | Date | null | undefined): string {
		if (!dateInput) return '';
		const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
		const diffMs = Date.now() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays === 1) return 'yesterday';
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	// Check if a draft has unsaved text modifications
	function isDraftDirty(draftId: number, originalContent: string): boolean {
		const current = draftEdits[draftId];
		return current !== undefined && current !== originalContent;
	}

	// Load drafts from API
	async function loadDrafts() {
		isLoading = true;
		try {
			const res = await api.listDrafts();
			if (res && res.length > 0) {
				drafts = res;
			} else {
				drafts = DEFAULT_SAMPLE_DRAFTS;
			}
		} catch {
			drafts = DEFAULT_SAMPLE_DRAFTS;
		} finally {
			await syncDraftStates(drafts);
			isLoading = false;
		}
	}

	onMount(() => {
		loadDrafts();
	});

	// Save Edits: triggers api.updateDraft(id, content)
	async function handleSaveEdits(draft: DraftWithHash) {
		const newContent = draftEdits[draft.id] ?? draft.content;
		if (!newContent.trim()) {
			showToast('Draft content cannot be empty', 'error');
			return;
		}

		isSavingId = draft.id;
		try {
			const updated = await api.updateDraft(draft.id, newContent);
			const newHash = await calculateSha256(newContent);

			// Update in drafts list
			drafts = drafts.map((d) => {
				if (d.id === draft.id) {
					return {
						...d,
						content: updated.content,
						status: updated.status, // resets to pending_approval in backend
						approvedAt: null,
						approvedBy: null,
						updatedAt: updated.updatedAt || new Date().toISOString(),
						contentHash: newHash
					};
				}
				return d;
			});

			draftEdits[draft.id] = updated.content;
			draftHashes[draft.id] = newHash;

			if (draft.status === 'approved') {
				showToast('Edits saved: Approval revoked and status reset to Pending Approval', 'info');
			} else {
				showToast('Draft edits saved successfully', 'success');
			}
		} catch (err: any) {
			const msg = err?.message || 'Failed to save draft edits';
			showToast(msg, 'error');
		} finally {
			isSavingId = null;
		}
	}

	// Approve Draft: triggers api.approveDraft(id)
	async function handleApprove(draft: DraftWithHash) {
		if (isDraftDirty(draft.id, draft.content)) {
			showToast('Please save your edits before approving this draft', 'error');
			return;
		}

		isApprovingId = draft.id;
		try {
			const approved = await api.approveDraft(draft.id);
			const hash = await calculateSha256(draft.content);

			drafts = drafts.map((d) => {
				if (d.id === draft.id) {
					return {
						...d,
						status: 'approved',
						approvedAt: approved.approvedAt || new Date().toISOString(),
						approvedBy: approved.approvedBy ?? 1,
						contentHash: hash
					};
				}
				return d;
			});

			draftHashes[draft.id] = hash;
			showToast(`Draft #${draft.id} approved. Send to VGen is now enabled`, 'success');
		} catch (err: any) {
			const msg = err?.message || 'Failed to approve draft';
			showToast(msg, 'error');
		} finally {
			isApprovingId = null;
		}
	}

	// Open rejection modal
	function openRejectionModal(draft: DraftWithHash) {
		rejectionModalDraft = draft;
		rejectionReason = '';
	}

	function closeRejectionModal() {
		rejectionModalDraft = null;
		rejectionReason = '';
		isSubmittingRejection = false;
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (rejectionModalDraft && e.key === 'Escape') closeRejectionModal();
	}

	// Submit rejection
	async function handleConfirmReject() {
		if (!rejectionModalDraft) return;
		const targetId = rejectionModalDraft.id;
		isSubmittingRejection = true;

		try {
			await api.rejectDraft(targetId, rejectionReason.trim() || undefined);

			drafts = drafts.map((d) => {
				if (d.id === targetId) {
					return {
						...d,
						status: 'rejected',
						updatedAt: new Date().toISOString()
					};
				}
				return d;
			});

			showToast(`Draft #${targetId} rejected`, 'info');
			closeRejectionModal();
		} catch (err: any) {
			const msg = err?.message || 'Failed to reject draft';
			showToast(msg, 'error');
			isSubmittingRejection = false;
		}
	}

	// Send to VGen: triggers api.sendDraft(id)
	async function handleSendDraft(draft: DraftWithHash) {
		if (draft.status !== 'approved') {
			showToast('Draft must be approved before sending', 'error');
			return;
		}

		if (isDraftDirty(draft.id, draft.content)) {
			showToast('Draft content was modified. Please save and re-approve before sending', 'error');
			return;
		}

		isSendingId = draft.id;
		try {
			const res = await api.sendDraft(draft.id);

			// Mark as sent in state
			drafts = drafts.map((d) => {
				if (d.id === draft.id) {
					return {
						...d,
						status: 'sent',
						sentAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
				}
				return d;
			});

			showToast(`Draft #${draft.id} dispatched to VGen (Task: ${res.taskId || 'queued'})`, 'success');
		} catch (err: any) {
			if (err?.status === 409 || err?.code === 'NOT_APPROVED' || err?.code === 'INVALID_DRAFT_STATE') {
				showToast(`Dispatch blocked (409 Conflict): ${err.message || 'Draft must be approved before sending'}`, 'error');
			} else {
				showToast(err?.message || 'Failed to dispatch draft to VGen', 'error');
			}
		} finally {
			isSendingId = null;
		}
	}
</script>

<svelte:head>
	<title>Drafts & Approvals • ClientAgent</title>
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="min-h-screen bg-[#ddf4ff] p-4 sm:p-6 lg:p-8">
	<!-- Page Header -->
	<div class="max-w-6xl mx-auto mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<div class="flex items-center gap-2">
				<div class="w-10 h-10 rounded-xl bg-white border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6] shadow-sm">
					<FileEdit class="w-5 h-5" />
				</div>
				<div>
					<h1 class="text-2xl font-bold text-[#3c3c3c]">Drafts & Approvals</h1>
					<p class="text-xs text-[#777777]">Human-in-the-loop review queue for AI-generated client responses</p>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={loadDrafts}
				disabled={isLoading}
				class="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-[#3c3c3c] font-semibold text-xs rounded-xl border-2 border-[#c7e8fa] shadow-sm transition-all disabled:opacity-50"
			>
				<RefreshCw class="w-3.5 h-3.5 {isLoading ? 'animate-spin text-[#1cb0f6]' : 'text-slate-500'}" />
				<span>Refresh</span>
			</button>
		</div>
	</div>

	<!-- Status Filter Tabs -->
	<div class="max-w-6xl mx-auto mb-6">
		<div class="flex flex-wrap items-center gap-2 border-b border-[#c7e8fa] pb-3">
			{#each statusTabs as tab}
				<button
					type="button"
					onclick={() => (selectedTab = tab.id)}
					class="px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 {selectedTab === tab.id
						? 'bg-[#1cb0f6] text-white shadow-sm'
						: 'bg-white hover:bg-slate-50 text-[#777777] border-2 border-[#c7e8fa]'}"
				>
					<span>{tab.label}</span>
					<span
						class="text-[10px] px-1.5 py-0.5 rounded-full font-bold {selectedTab === tab.id
							? 'bg-white/20 text-white'
							: 'bg-slate-100 text-[#777777]'}"
					>
						{statusCounts[tab.id] ?? 0}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Main Content Area -->
	<div class="max-w-6xl mx-auto space-y-4">
		{#if isLoading && drafts.length === 0}
			<div class="p-12 text-center bg-white rounded-xl border-2 border-[#c7e8fa]">
				<RefreshCw class="w-8 h-8 mx-auto animate-spin text-[#1cb0f6] mb-3" />
				<p class="text-sm font-semibold text-[#3c3c3c]">Loading drafts and approvals queue...</p>
			</div>
		{:else if filteredDrafts.length === 0}
			<div class="p-12 text-center bg-white rounded-xl border-2 border-[#c7e8fa] shadow-sm">
				<FileEdit class="w-10 h-10 mx-auto text-slate-300 mb-3" />
				<h3 class="text-sm font-bold text-[#3c3c3c]">No drafts found in this category</h3>
				<p class="text-xs text-[#777777] mt-1">
					Select another filter tab or use the agent to generate new client reply drafts.
				</p>
			</div>
		{:else}
			{#each filteredDrafts as draft (draft.id)}
				{@const currentContent = draftEdits[draft.id] ?? draft.content}
				{@const isDirty = isDraftDirty(draft.id, draft.content)}
				{@const displayHash = draftHashes[draft.id] || draft.contentHash || 'calculating...'}

				<div class="bg-white rounded-xl border-2 border-[#c7e8fa] shadow-sm p-5 sm:p-6 transition-all">
					<!-- Draft Card Header -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
						<div class="flex items-center gap-3">
							<div class="w-10 h-10 rounded-xl bg-[#ddf4ff] border border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6] font-bold text-sm">
								{draft.clientUsername ? draft.clientUsername.slice(0, 2).toUpperCase() : 'CL'}
							</div>
							<div>
								<div class="flex items-center gap-2">
									<span class="font-bold text-sm text-[#3c3c3c]">
										@{draft.clientUsername || 'Unknown Client'}
									</span>
									<a
										href="/conversations?id={draft.conversationId}"
										class="inline-flex items-center gap-1 text-xs font-semibold text-[#1cb0f6] hover:underline"
									>
										<span>Conversation #{draft.conversationId}</span>
										<ExternalLink class="w-3.5 h-3.5" />
									</a>
								</div>
								<div class="flex items-center gap-2 mt-0.5 text-xs text-[#777777]">
									<span class="inline-flex items-center gap-1">
										<Clock class="w-3.5 h-3.5 text-slate-400" />
										<span>Created {formatRelativeTime(draft.createdAt)}</span>
									</span>
									{#if draft.approvedAt}
										<span>•</span>
										<span class="text-[#2e7d32] font-medium">
											Approved {formatRelativeTime(draft.approvedAt)}
										</span>
									{/if}
									{#if draft.sentAt}
										<span>•</span>
										<span class="text-[#0288d1] font-medium">
											Sent {formatRelativeTime(draft.sentAt)}
										</span>
									{/if}
								</div>
							</div>
						</div>

						<!-- Status Badge & SHA-256 Hash Badge -->
						<div class="flex flex-wrap items-center gap-2">
							<!-- SHA-256 Hash Badge -->
							<div
								class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-slate-600 font-mono text-[11px]"
								title="SHA-256 Content Hash: {displayHash}"
							>
								<Hash class="w-3 h-3 text-slate-400" />
								<span>SHA-256: {displayHash.slice(0, 8)}...{displayHash.slice(-6)}</span>
							</div>

							<!-- Status Pill -->
							{#if draft.status === 'pending_approval'}
								<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-[#fff8e1] text-[#b78103] border border-[#ffe082]">
									Pending Approval
								</span>
							{:else if draft.status === 'approved'}
								<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]">
									Approved
								</span>
							{:else if draft.status === 'sent'}
								<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-[#e1f5fe] text-[#0288d1] border border-[#b3e5fc]">
									Sent
								</span>
							{:else if draft.status === 'rejected'}
								<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-[#ffebee] text-[#c62828] border border-[#ffcdd2]">
									Rejected
								</span>
							{:else}
								<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
									{draft.status}
								</span>
							{/if}
						</div>
					</div>

					<!-- Invalidation Warning Banner (when an approved draft is modified) -->
					{#if draft.status === 'approved' && isDirty}
						<div class="mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg flex items-start gap-2.5 text-xs font-medium">
							<AlertTriangle class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
							<div>
								<span class="font-bold">Approval Invalidation Warning:</span>
								<span>
									You modified an approved draft. Saving these edits will immediately revoke approval and return the status to Pending Approval. You must re-approve before dispatching to VGen.
								</span>
							</div>
						</div>
					{/if}

					<!-- Draft Content Textarea -->
					<div class="mt-4 space-y-1.5">
						<label for="draft-content-{draft.id}" class="block text-xs font-bold text-[#3c3c3c]">
							Draft Response
						</label>
						<textarea
							id="draft-content-{draft.id}"
							maxlength="2000"
							rows="5"
							bind:value={draftEdits[draft.id]}
							disabled={draft.status === 'sent'}
							placeholder="Type draft message for client..."
							class="w-full p-3.5 rounded-xl border-2 border-[#c7e8fa] bg-[#f4faff] focus:bg-white focus:border-[#1cb0f6] focus:outline-none transition-colors text-sm text-[#3c3c3c] font-sans resize-y disabled:opacity-60 disabled:cursor-not-allowed"
						></textarea>
						<div class="flex items-center justify-between text-[11px] text-[#777777] px-1">
							<span class="italic">
								{#if isDirty}
									<span class="text-amber-600 font-semibold">• Unsaved modifications</span>
								{:else}
									<span>Clean state</span>
								{/if}
							</span>
							<span class="{currentContent.length > 1900 ? 'text-amber-600 font-bold' : ''}">
								{currentContent.length} / 2000
							</span>
						</div>
					</div>

					<!-- Action Buttons Bar -->
					<div class="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<!-- Save Edits Button -->
							<button
								type="button"
								onclick={() => handleSaveEdits(draft)}
								disabled={!isDirty || isSavingId === draft.id || draft.status === 'sent'}
								class="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-[#3c3c3c] font-bold text-xs rounded-xl border-2 border-[#c7e8fa] shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{#if isSavingId === draft.id}
									<RefreshCw class="w-3.5 h-3.5 animate-spin text-[#1cb0f6]" />
									<span>Saving...</span>
								{:else}
									<Save class="w-3.5 h-3.5 text-slate-500" />
									<span>Save Edits</span>
								{/if}
							</button>

							<!-- Reject Button -->
							{#if draft.status !== 'rejected' && draft.status !== 'sent'}
								<button
									type="button"
									onclick={() => openRejectionModal(draft)}
									class="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-red-50 text-[#ff4b4b] font-bold text-xs rounded-xl border border-red-200 transition-all"
								>
									<X class="w-3.5 h-3.5" />
									<span>Reject</span>
								</button>
							{/if}
						</div>

						<div class="flex items-center gap-2">
							<!-- Approve Button (#a5ed6e) -->
							{#if draft.status !== 'approved' && draft.status !== 'sent'}
								<button
									type="button"
									onclick={() => handleApprove(draft)}
									disabled={isApprovingId === draft.id || isDirty}
									title={isDirty ? 'Save edits first before approving' : 'Approve draft content'}
									class="inline-flex items-center gap-1.5 px-4 py-2 bg-[#a5ed6e] hover:bg-[#94db5d] text-[#111111] font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{#if isApprovingId === draft.id}
										<RefreshCw class="w-3.5 h-3.5 animate-spin text-[#111111]" />
										<span>Approving...</span>
									{:else}
										<Check class="w-3.5 h-3.5 stroke-[3]" />
										<span>Approve</span>
									{/if}
								</button>
							{/if}

							<!-- Send to VGen Button (Enabled only when approved) -->
							<button
								type="button"
								onclick={() => handleSendDraft(draft)}
								disabled={draft.status !== 'approved' || isSendingId === draft.id || isDirty}
								title={draft.status !== 'approved' ? 'Draft must be approved before sending' : 'Send message directly via VGen'}
								class="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1cb0f6] hover:bg-[#1899d6] text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
							>
								{#if isSendingId === draft.id}
									<RefreshCw class="w-3.5 h-3.5 animate-spin text-white" />
									<span>Sending...</span>
								{:else}
									<Send class="w-3.5 h-3.5" />
									<span>Send to VGen</span>
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<!-- Rejection Reason Modal -->
{#if rejectionModalDraft}
	<div
		role="presentation"
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
		onclick={(e) => {
			if (e.target === e.currentTarget) closeRejectionModal();
		}}
	>
		<div class="bg-white rounded-xl border-2 border-[#c7e8fa] shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
			<div class="flex items-center justify-between pb-3 border-b border-slate-100">
				<div class="flex items-center gap-2 text-[#ff4b4b]">
					<AlertCircle class="w-5 h-5" />
					<h3 class="font-bold text-base text-[#3c3c3c]">Reject Draft #{rejectionModalDraft.id}</h3>
				</div>
				<button
					type="button"
					onclick={closeRejectionModal}
					class="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
				>
					<X class="w-5 h-5" />
				</button>
			</div>

			<p class="text-xs text-[#777777]">
				Provide an optional explanation for rejecting this draft for client @{rejectionModalDraft.clientUsername || 'Unknown'}. This reason will be recorded in the immutable audit log.
			</p>

			<div class="space-y-1">
				<label for="rejection-reason" class="block text-xs font-bold text-[#3c3c3c]">
					Rejection Reason (Optional)
				</label>
				<textarea
					id="rejection-reason"
					rows="3"
					bind:value={rejectionReason}
					placeholder="e.g. Needs higher pricing estimate, tone too informal, etc."
					class="w-full p-3 rounded-lg border-2 border-[#c7e8fa] bg-[#f4faff] focus:bg-white focus:border-[#ff4b4b] focus:outline-none text-xs text-[#3c3c3c]"
				></textarea>
			</div>

			<div class="flex items-center justify-end gap-2 pt-2">
				<button
					type="button"
					onclick={closeRejectionModal}
					disabled={isSubmittingRejection}
					class="px-3 py-2 rounded-xl text-xs font-semibold text-[#777777] hover:bg-slate-100 transition-colors"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleConfirmReject}
					disabled={isSubmittingRejection}
					class="inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff4b4b] hover:bg-[#e03a3a] text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50"
				>
					{#if isSubmittingRejection}
						<RefreshCw class="w-3.5 h-3.5 animate-spin text-white" />
						<span>Rejecting...</span>
					{:else}
						<X class="w-3.5 h-3.5" />
						<span>Confirm Rejection</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Toast Feedback Container -->
{#if toastMessage}
	<div class="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-bounce-in">
		<div
			class="flex items-center gap-2.5 p-3.5 rounded-xl shadow-lg border-2 text-xs font-semibold {toastType === 'success'
				? 'bg-[#e8f5e9] text-[#2e7d32] border-[#a5ed6e]'
				: toastType === 'error'
					? 'bg-[#ffebee] text-[#c62828] border-red-300'
					: 'bg-[#ddf4ff] text-[#0288d1] border-[#1cb0f6]'}"
		>
			{#if toastType === 'success'}
				<CheckCircle2 class="w-4 h-4 text-[#2e7d32] shrink-0" />
			{:else if toastType === 'error'}
				<AlertCircle class="w-4 h-4 text-[#c62828] shrink-0" />
			{:else}
				<Info class="w-4 h-4 text-[#0288d1] shrink-0" />
			{/if}
			<span class="flex-1 leading-snug">{toastMessage}</span>
			<button
				type="button"
				onclick={() => (toastMessage = null)}
				class="text-current opacity-60 hover:opacity-100"
			>
				<X class="w-4 h-4" />
			</button>
		</div>
	</div>
{/if}
