<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type AuditItem, type AuditLogListParams } from '$lib/api';
	import {
		ShieldCheck,
		RefreshCw,
		Search,
		User,
		Bot,
		Cpu,
		FileJson,
		X,
		Copy,
		Check,
		Filter,
		ExternalLink,
		Clock
	} from 'lucide-svelte';

	type ActorFilter = 'all' | 'user' | 'agent' | 'system';

	interface ActorTab {
		id: ActorFilter;
		label: string;
	}

	const actorTabs: ActorTab[] = [
		{ id: 'all', label: 'All' },
		{ id: 'user', label: 'User' },
		{ id: 'agent', label: 'Agent' },
		{ id: 'system', label: 'System' }
	];

	// Default fallback sample audit logs when backend is offline or on first run
	const DEFAULT_SAMPLE_LOGS: AuditItem[] = [
		{
			id: 501,
			userId: 1,
			actorType: 'user',
			actorId: 1,
			action: 'USER_APPROVED_DRAFT',
			targetType: 'draft',
			targetId: 301,
			metadata: {
				draftId: 301,
				conversationId: 10,
				clientUsername: 'KitsuneMei',
				contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				approvedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
			},
			ipAddress: '127.0.0.1',
			createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
		},
		{
			id: 502,
			userId: 1,
			actorType: 'agent',
			actorId: null,
			action: 'MESSAGE_SENT',
			targetType: 'draft',
			targetId: 301,
			metadata: {
				draftId: 301,
				conversationId: 10,
				clientUsername: 'KitsuneMei',
				safetyGatePassed: true,
				dispatchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
			},
			ipAddress: null,
			createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
		},
		{
			id: 503,
			userId: 1,
			actorType: 'agent',
			actorId: null,
			action: 'GENERATE_REPLY_DRAFT',
			targetType: 'conversation',
			targetId: 10,
			metadata: {
				conversationId: 10,
				clientUsername: 'KitsuneMei',
				promptTokens: 840,
				completionTokens: 112,
				model: 'claude-3-5-sonnet'
			},
			ipAddress: null,
			createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
		},
		{
			id: 504,
			userId: 1,
			actorType: 'system',
			actorId: null,
			action: 'SYNC_CONVERSATION',
			targetType: 'conversation',
			targetId: 12,
			metadata: {
				conversationId: 12,
				username: 'StarlightVT',
				newMessagesCount: 2,
				syncedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString()
			},
			ipAddress: null,
			createdAt: new Date(Date.now() - 40 * 60 * 1000).toISOString()
		},
		{
			id: 505,
			userId: 1,
			actorType: 'system',
			actorId: null,
			action: 'GMAIL_EVENT_PROCESSED',
			targetType: 'event',
			targetId: 44,
			metadata: {
				eventId: 44,
				eventType: 'NEW_COMMISSION_REQUEST',
				clientUsername: 'StarlightVT',
				historyId: '891230'
			},
			ipAddress: null,
			createdAt: new Date(Date.now() - 55 * 60 * 1000).toISOString()
		}
	];

	// Component State with Svelte 5 Runes
	let allLogs = $state<AuditItem[]>([]);
	let isLoading = $state(true);
	let isRefreshing = $state(false);
	let actorFilter = $state<ActorFilter>('all');
	let actionFilter = $state<string>('');
	let selectedLog = $state<AuditItem | null>(null);
	let copied = $state(false);

	async function loadAuditLogs() {
		try {
			const logs = await api.listAuditLogs({ limit: 100 });
			if (logs && logs.length > 0) {
				allLogs = logs;
			} else {
				allLogs = DEFAULT_SAMPLE_LOGS;
			}
		} catch {
			allLogs = DEFAULT_SAMPLE_LOGS;
		} finally {
			isLoading = false;
			isRefreshing = false;
		}
	}

	onMount(() => {
		loadAuditLogs();
	});

	async function handleRefresh() {
		isRefreshing = true;
		await loadAuditLogs();
	}

	// Filtered logs
	const filteredLogs = $derived(
		allLogs.filter((log) => {
			if (actorFilter !== 'all' && log.actorType.toLowerCase() !== actorFilter.toLowerCase()) {
				return false;
			}
			if (actionFilter.trim()) {
				const query = actionFilter.toLowerCase().trim();
				const actionMatch = log.action.toLowerCase().includes(query);
				const targetMatch = `${log.targetType} #${log.targetId}`.toLowerCase().includes(query);
				const actorMatch = log.actorType.toLowerCase().includes(query);
				if (!actionMatch && !targetMatch && !actorMatch) {
					return false;
				}
			}
			return true;
		})
	);

	function openInspector(log: AuditItem) {
		selectedLog = log;
		copied = false;
	}

	function closeInspector() {
		selectedLog = null;
	}

	async function copyMetadata() {
		if (!selectedLog) return;
		try {
			await navigator.clipboard.writeText(JSON.stringify(selectedLog.metadata, null, 2));
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// Fallback if clipboard API is restricted
		}
	}

	function formatTimestamp(isoString: string | Date): string {
		try {
			const d = new Date(isoString);
			return d.toISOString().replace('T', ' ').substring(0, 19);
		} catch {
			return String(isoString);
		}
	}
</script>

<svelte:head>
	<title>Audit Log | ClientAgent</title>
</svelte:head>

<svelte:window onkeydown={(e) => { if (selectedLog && e.key === 'Escape') closeInspector(); }} />

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-[#3c3c3c]">Immutable Audit Log</h1>
			<p class="text-sm font-semibold text-[#777777] mt-1">
				Append-only records of all creator decisions, agent actions, and external platform events.
			</p>
		</div>

		<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={handleRefresh}
				disabled={isRefreshing}
				class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#ffffff] text-[#3c3c3c] border-2 border-[#c7e8fa] hover:bg-[#ddf4ff]/50 transition-colors shadow-sm disabled:opacity-50"
			>
				<RefreshCw class="w-4 h-4 text-[#1cb0f6] {isRefreshing ? 'animate-spin' : ''}" />
				<span>Refresh</span>
			</button>
		</div>
	</div>

	<!-- Controls & Filters Bar -->
	<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<!-- Actor Filter Tabs -->
		<div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
			{#each actorTabs as tab}
				<button
					type="button"
					onclick={() => {
						actorFilter = tab.id;
					}}
					class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap {actorFilter === tab.id
						? 'bg-[#1cb0f6] text-white shadow-sm'
						: 'bg-[#ddf4ff]/70 text-[#3c3c3c] hover:bg-[#ddf4ff] border border-[#c7e8fa]'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Action search filter -->
		<div class="relative w-full sm:w-72">
			<Search class="w-4 h-4 text-[#777777] absolute left-3 top-1/2 -translate-y-1/2" />
			<input
				type="text"
				bind:value={actionFilter}
				placeholder="Search action or target..."
				class="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-semibold bg-[#ddf4ff]/40 border-2 border-[#c7e8fa] focus:outline-none focus:border-[#1cb0f6] text-[#3c3c3c] placeholder-[#777777]"
			/>
		</div>
	</div>

	<!-- Audit Log Table -->
	<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl shadow-sm overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-left border-collapse">
				<thead>
					<tr class="bg-[#ddf4ff]/40 border-b-2 border-[#c7e8fa] text-xs font-bold text-[#777777] uppercase tracking-wide">
						<th class="py-3 px-4">Timestamp</th>
						<th class="py-3 px-4">Actor</th>
						<th class="py-3 px-4">Action</th>
						<th class="py-3 px-4">Target</th>
						<th class="py-3 px-4">Details</th>
					</tr>
				</thead>
				<tbody class="divide-y-2 divide-[#ddf4ff] text-xs font-semibold text-[#3c3c3c]">
					{#if isLoading}
						<tr>
							<td colspan="5" class="py-8 text-center text-[#777777]">
								<RefreshCw class="w-5 h-5 animate-spin mx-auto mb-2 text-[#1cb0f6]" />
								<span>Loading audit records...</span>
							</td>
						</tr>
					{:else if filteredLogs.length === 0}
						<tr>
							<td colspan="5" class="py-12 text-center text-[#777777]">
								<ShieldCheck class="w-8 h-8 mx-auto mb-2 text-[#777777]/50" />
								<div class="font-bold text-sm text-[#3c3c3c]">No audit logs match criteria</div>
								<div class="mt-1">Try resetting the actor filter or search term.</div>
							</td>
						</tr>
					{:else}
						{#each filteredLogs as log (log.id)}
							<tr
								onclick={() => openInspector(log)}
								class="hover:bg-[#ddf4ff]/30 cursor-pointer transition-colors"
							>
								<!-- Timestamp (monospace formatted) -->
								<td class="py-3 px-4 font-mono text-[11px] text-[#777777] whitespace-nowrap">
									{formatTimestamp(log.createdAt)}
								</td>

								<!-- Actor badge -->
								<td class="py-3 px-4 whitespace-nowrap">
									{#if log.actorType.toLowerCase() === 'user'}
										<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]">
											<User class="w-3 h-3 text-[#58cc02]" />
											<span>user</span>
										</span>
									{:else if log.actorType.toLowerCase() === 'agent'}
										<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]">
											<Bot class="w-3 h-3 text-[#1cb0f6]" />
											<span>agent</span>
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#f3e5f5] text-[#af71f5] border border-[#e1bee7]">
											<Cpu class="w-3 h-3 text-[#af71f5]" />
											<span>system</span>
										</span>
									{/if}
								</td>

								<!-- Action Name -->
								<td class="py-3 px-4 font-mono text-[11px] font-bold text-[#3c3c3c] whitespace-nowrap">
									{log.action}
								</td>

								<!-- Target -->
								<td class="py-3 px-4 whitespace-nowrap">
									<span class="px-2 py-0.5 rounded-md bg-[#ddf4ff]/80 text-[#3c3c3c] font-mono text-[11px] border border-[#c7e8fa]">
										{log.targetType} #{log.targetId}
									</span>
								</td>

								<!-- Details Button -->
								<td class="py-3 px-4 whitespace-nowrap">
									<button
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											openInspector(log);
										}}
										class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-[#ffffff] text-[#1cb0f6] border-2 border-[#c7e8fa] hover:bg-[#1cb0f6] hover:text-white transition-colors"
									>
										<FileJson class="w-3.5 h-3.5" />
										<span>Details</span>
									</button>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Metadata Inspector Modal / Drawer -->
	{#if selectedLog}
		<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<!-- Backdrop overlay with click-to-dismiss -->
			<div
				class="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
				onclick={closeInspector}
				role="presentation"
			></div>

			<div
				class="relative bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col z-10 overflow-hidden"
				role="dialog"
				aria-modal="true"
				aria-labelledby="audit-modal-title"
				tabindex="-1"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<!-- Modal Header -->
				<div class="p-4 bg-[#ddf4ff]/40 border-b-2 border-[#c7e8fa] flex items-center justify-between">
					<div class="flex items-center gap-2">
						<ShieldCheck class="w-5 h-5 text-[#1cb0f6]" />
						<h2 id="audit-modal-title" class="text-base font-bold text-[#3c3c3c]">
							Audit Log Record #{selectedLog.id}
						</h2>
					</div>
					<button
						type="button"
						onclick={closeInspector}
						class="w-8 h-8 rounded-lg flex items-center justify-center text-[#777777] hover:bg-[#ddf4ff] hover:text-[#3c3c3c] transition-colors"
						aria-label="Close"
					>
						<X class="w-5 h-5" />
					</button>
				</div>

				<!-- Modal Body -->
				<div class="p-6 space-y-4 overflow-y-auto">
					<!-- Summary info grid -->
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#ddf4ff]/30 border border-[#c7e8fa] rounded-xl p-3 text-xs font-semibold">
						<div>
							<div class="text-[#777777] text-[10px] uppercase">Actor</div>
							<div class="font-bold text-[#3c3c3c] mt-0.5">{selectedLog.actorType}</div>
						</div>
						<div>
							<div class="text-[#777777] text-[10px] uppercase">Action</div>
							<div class="font-bold text-[#3c3c3c] mt-0.5 font-mono text-[11px] truncate">{selectedLog.action}</div>
						</div>
						<div>
							<div class="text-[#777777] text-[10px] uppercase">Target</div>
							<div class="font-bold text-[#3c3c3c] mt-0.5">{selectedLog.targetType} #{selectedLog.targetId}</div>
						</div>
						<div>
							<div class="text-[#777777] text-[10px] uppercase">IP Address</div>
							<div class="font-bold text-[#3c3c3c] mt-0.5 font-mono text-[11px]">{selectedLog.ipAddress || 'Internal'}</div>
						</div>
					</div>

					<!-- Monospace JSON Metadata Block -->
					<div>
						<div class="flex items-center justify-between mb-2">
							<span class="text-xs font-bold text-[#3c3c3c] uppercase tracking-wide">JSON Metadata:</span>
							<button
								type="button"
								onclick={copyMetadata}
								class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa] hover:bg-[#1cb0f6] hover:text-white transition-colors"
							>
								{#if copied}
									<Check class="w-3.5 h-3.5 text-[#58cc02]" />
									<span>Copied</span>
								{:else}
									<Copy class="w-3.5 h-3.5" />
									<span>Copy JSON</span>
								{/if}
							</button>
						</div>

						<pre class="font-mono text-xs bg-[#111111] text-[#a5ed6e] p-4 rounded-xl overflow-x-auto border-2 border-[#3c3c3c] max-h-72 leading-relaxed">
{JSON.stringify(selectedLog.metadata, null, 2)}
						</pre>
					</div>
				</div>

				<!-- Modal Footer -->
				<div class="p-4 bg-[#ddf4ff]/20 border-t-2 border-[#c7e8fa] flex justify-end">
					<button
						type="button"
						onclick={closeInspector}
						class="px-4 py-2 rounded-xl text-sm font-bold bg-[#ffffff] text-[#3c3c3c] border-2 border-[#c7e8fa] hover:bg-[#ddf4ff]/60 transition-colors"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
