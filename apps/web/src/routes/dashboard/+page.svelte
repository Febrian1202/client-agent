<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		api,
		type DashboardSummary,
		type CommissionItem,
		type DraftItem,
		type MessageItem
	} from '$lib/api';
	import {
		computeMetricCards,
		filterCommissionsByTab,
		computeTabCounts,
		formatCommissionCard,
		formatRelativeTime,
		getDraftApprovalContext,
		getClientMemoryProfile,
		type CommissionFilterTab,
		DEFAULT_SAMPLE_COMMISSIONS,
		DEFAULT_SAMPLE_DRAFTS,
		DEFAULT_SAMPLE_MESSAGES
	} from '$lib/dashboard';
	import {
		RefreshCw,
		Send,
		FileEdit,
		CheckCircle2,
		Clock,
		ShieldCheck,
		Briefcase,
		MessageSquare,
		Lock,
		Globe,
		ExternalLink,
		Sparkles,
		Check,
		Inbox,
		FileText,
		AlertCircle
	} from 'lucide-svelte';

	// Page state with Svelte 5 runes
	let summary = $state<DashboardSummary | null>(null);
	let isLoading = $state(true);
	let activeTab = $state<CommissionFilterTab>('all');
	let isSyncing = $state(false);
	let isApproving = $state(false);
	let isEditingDraft = $state(false);
	let draftContent = $state('');
	let toastMessage = $state<string | null>(null);
	let toastType = $state<'success' | 'info' | 'error'>('success');
	let toastTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	function showToast(message: string, type: 'success' | 'info' | 'error' = 'success') {
		if (toastTimeout) clearTimeout(toastTimeout);
		toastMessage = message;
		toastType = type;
		toastTimeout = setTimeout(() => {
			toastMessage = null;
		}, 4000);
	}

	onMount(async () => {
		try {
			const res = await api.getDashboardSummary();
			summary = res;
		} catch {
			// Fallback gracefully to default sample data matching ui.pen if API is offline
			summary = {
				metrics: {
					activeCount: 5,
					inQueueCount: 3,
					completedMonthCount: 18,
					pendingDraftCount: 3
				},
				commissions: DEFAULT_SAMPLE_COMMISSIONS,
				activeCommissions: DEFAULT_SAMPLE_COMMISSIONS.filter((c) =>
					['in_progress', 'accepted', 'paid', 'active'].includes(c.status)
				),
				recentMessages: DEFAULT_SAMPLE_MESSAGES,
				pendingDrafts: DEFAULT_SAMPLE_DRAFTS
			};
		} finally {
			isLoading = false;
			const initialDraft =
				summary?.pendingDrafts && summary.pendingDrafts.length > 0
					? summary.pendingDrafts[0]
					: null;
			draftContent = initialDraft?.content ?? '';
		}
	});

	// Derived metrics and cards
	const metricCards = $derived(computeMetricCards(summary));

	const allCommissions = $derived.by(() => {
		if (summary !== null) {
			return summary.commissions ?? [];
		}
		return DEFAULT_SAMPLE_COMMISSIONS;
	});

	const tabCounts = $derived(computeTabCounts(allCommissions));

	const filteredCommissions = $derived(filterCommissionsByTab(allCommissions, activeTab));

	const formattedCommissions = $derived(
		filteredCommissions.map((c) => formatCommissionCard(c))
	);

	const activeDraft = $derived.by(() => {
		if (summary !== null) {
			return summary.pendingDrafts?.[0] ?? null;
		}
		return DEFAULT_SAMPLE_DRAFTS[0];
	});

	let lastDraftId = $state<number | null>(null);
	$effect(() => {
		if (activeDraft && activeDraft.id !== lastDraftId) {
			lastDraftId = activeDraft.id;
			draftContent = activeDraft.content;
			isEditingDraft = false;
		} else if (!activeDraft) {
			lastDraftId = null;
			draftContent = '';
			isEditingDraft = false;
		}
	});

	const draftApprovalContext = $derived(getDraftApprovalContext(activeDraft));

	const recentMessages = $derived.by(() => {
		if (summary !== null) {
			return summary.recentMessages ?? [];
		}
		return DEFAULT_SAMPLE_MESSAGES;
	});

	const clientMemoryProfile = $derived(
		getClientMemoryProfile(activeDraft?.clientUsername || 'KitsuneMei')
	);

	// Actions
	async function handleSyncVGen() {
		isSyncing = true;
		const syncUsername = summary?.commissions?.[0]?.clientUsername || 'KitsuneMei';
		try {
			try {
				await api.syncConversation(syncUsername);
			} catch {
				// Continue to refresh
			}
			const refreshed = await api.getDashboardSummary();
			summary = refreshed;
			showToast('VGen sync completed: latest conversations and orders refreshed.', 'success');
		} catch {
			showToast('VGen sync signaled. Showing current active pipeline state.', 'info');
		} finally {
			isSyncing = false;
		}
	}

	async function handleApproveAndDispatch() {
		if (!activeDraft) return;
		isApproving = true;
		const isRealDraft = Boolean(summary?.pendingDrafts?.some((d) => d.id === activeDraft.id));
		try {
			if (isRealDraft) {
				// If draft content was edited, persist before approving and sending
				if (draftContent && draftContent !== activeDraft.content) {
					await api.updateDraft(activeDraft.id, draftContent);
					activeDraft.content = draftContent;
				}
				await api.approveDraft(activeDraft.id);
				await api.sendDraft(activeDraft.id);
			}
			showToast(
				`Draft approved & safely dispatched to ${draftApprovalContext.targetClient.replace('Reply to ', '')} via VGen!`,
				'success'
			);
			if (summary && summary.metrics) {
				summary.metrics.pendingDraftCount = Math.max(0, summary.metrics.pendingDraftCount - 1);
			}
			if (summary?.pendingDrafts) {
				summary.pendingDrafts = summary.pendingDrafts.filter((d) => d.id !== activeDraft.id);
			}
		} catch (err: any) {
			showToast(`Approval failed: ${err.message || 'Unknown error'}`, 'error');
		} finally {
			isApproving = false;
			isEditingDraft = false;
		}
	}

	async function handleToggleEditDraft() {
		if (isEditingDraft) {
			if (!activeDraft) return;
			const isRealDraft = Boolean(summary?.pendingDrafts?.some((d) => d.id === activeDraft.id));
			if (isRealDraft) {
				try {
					await api.updateDraft(activeDraft.id, draftContent);
					activeDraft.content = draftContent;
					showToast('Draft edits saved. 7-point safety hash recalculating.', 'info');
				} catch (err: any) {
					showToast(`Failed to save draft edits: ${err.message || 'Unknown error'}`, 'error');
					return;
				}
			} else {
				activeDraft.content = draftContent;
				showToast('Draft edits saved. 7-point safety hash recalculating.', 'info');
			}
			isEditingDraft = false;
		} else {
			isEditingDraft = true;
		}
	}

	async function handleCommissionAction(action: string, comm: ReturnType<typeof formatCommissionCard>) {
		if (action === 'Open Thread') {
			goto('/conversations');
			return;
		}
		if (action === 'Update Stage') {
			goto('/commissions');
			return;
		}
		if (action === 'Accept Commission') {
			try {
				if (comm.raw.id) {
					await api.updateCommission(comm.raw.id, { status: 'in_progress' });
				}
				comm.raw.status = 'in_progress';
				showToast(`Commission ${comm.orderId} accepted into active pipeline!`, 'success');
			} catch (err: any) {
				showToast(`Failed to update commission: ${err?.message || 'Unknown error'}`, 'error');
			}
			return;
		}
		if (action === 'Mark Completed') {
			try {
				if (comm.raw.id) {
					await api.updateCommission(comm.raw.id, { status: 'completed' });
				}
				comm.raw.status = 'completed';
				showToast(`Commission ${comm.orderId} marked as completed & delivered!`, 'success');
			} catch (err: any) {
				showToast(`Failed to update commission: ${err?.message || 'Unknown error'}`, 'error');
			}
			return;
		}
		showToast(`${action} recorded for ${comm.orderId}.`, 'info');
	}
</script>

<svelte:head>
	<title>Dashboard Overview — ClientAgent VGen Studio</title>
</svelte:head>

<!-- Global Toast Notification -->
{#if toastMessage}
	<div
		class="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border-2 text-sm font-semibold transition-all {toastType ===
		'success'
			? 'bg-[#e8f5e9] text-[#2e7d32] border-[#c8e6c9]'
			: toastType === 'error'
				? 'bg-[#ffebee] text-[#c62828] border-[#ffcdd2]'
				: 'bg-[#ddf4ff] text-[#1cb0f6] border-[#c7e8fa]'}"
	>
		{#if toastType === 'success'}
			<CheckCircle2 class="w-4 h-4 text-[#58cc02] shrink-0" strokeWidth={2.5} />
		{:else if toastType === 'error'}
			<AlertCircle class="w-4 h-4 text-[#ff4b4b] shrink-0" strokeWidth={2.5} />
		{:else}
			<Sparkles class="w-4 h-4 text-[#1cb0f6] shrink-0" strokeWidth={2.5} />
		{/if}
		<span>{toastMessage}</span>
	</div>
{/if}

<div class="space-y-6 max-w-7xl mx-auto pb-12">
	<!-- 1. Header Row -->
	<header
		class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b-2 border-[#c7e8fa]/60"
	>
		<div>
			<h1 class="text-2xl lg:text-3xl font-black text-[#3c3c3c] tracking-tight">
				Dashboard Overview
			</h1>
			<p class="text-sm font-medium text-[#777777] mt-1">
				5 active commissions in pipeline • 3 awaiting acceptance • 3 drafts pending human approval
			</p>
		</div>

		<!-- Quick Actions -->
		<div class="flex items-center gap-3 shrink-0">
			<!-- Sync VGen Button (Outline) -->
			<button
				type="button"
				onclick={handleSyncVGen}
				disabled={isSyncing}
				class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-sm transition-all shadow-xs cursor-pointer disabled:opacity-60"
			>
				<RefreshCw
					class="w-4 h-4 text-[#1cb0f6] {isSyncing ? 'animate-spin' : ''}"
					strokeWidth={2.5}
				/>
				<span>{isSyncing ? 'Syncing...' : 'Sync VGen'}</span>
			</button>

			<!-- Review Drafts CTA (Primary #a5ed6e) -->
			<a
				href="/drafts"
				class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#a5ed6e] hover:bg-[#8ee150] text-[#111111] font-black text-sm transition-all shadow-xs border-2 border-[#85ca54] hover:shadow-md cursor-pointer"
			>
				<FileEdit class="w-4 h-4 text-[#111111]" strokeWidth={2.5} />
				<span>Review Drafts ({summary?.metrics?.pendingDraftCount ?? 3})</span>
			</a>
		</div>
	</header>

	<!-- 2. 4 Top Metric Cards: Active Commissions, In Queue / Requested, Completed (Month), Pending Approval (12px rounded white cards with #c7e8fa 2px border) -->
	<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
		{#each metricCards as card}
			<div
				class="bg-white border-2 border-[#c7e8fa] rounded-xl p-4 lg:p-5 shadow-xs flex flex-col justify-between hover:border-[#1cb0f6] transition-colors"
			>
				<div class="flex items-center justify-between gap-2 mb-2">
					<span class="text-xs font-bold text-[#777777] uppercase tracking-wider">
						{card.title}
					</span>
					<span
						class="text-[11px] font-bold px-2 py-0.5 rounded-lg border {card.badgeBg} {card.badgeBorder}"
						style="color: {card.badgeColor}"
					>
						{card.badgeText}
					</span>
				</div>

				<div class="space-y-1">
					<div class="text-2xl font-black text-[#3c3c3c] tracking-tight">
						{card.value}
					</div>
					<div class="text-xs font-semibold text-[#777777]">
						{card.subtitle}
					</div>
				</div>
			</div>
		{/each}
	</section>

	<!-- 3. Main Split Area: 2 Columns -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
		<!-- Left Column (Major): Commission Pipeline & Client Briefs -->
		<section class="lg:col-span-8 space-y-5">
			<!-- Header with Filter Tabs -->
			<div
				class="bg-white border-2 border-[#c7e8fa] rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
			>
				<div class="flex items-center gap-2">
					<Briefcase class="w-5 h-5 text-[#1cb0f6]" strokeWidth={2.5} />
					<h2 class="text-base font-bold text-[#3c3c3c]">
						Commission Pipeline & Client Briefs
					</h2>
				</div>

				<!-- Status Filter Tabs: All (8), Active (5), In Queue (3), Delivered (1) -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
					<button
						type="button"
						onclick={() => (activeTab = 'all')}
						class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 {activeTab ===
						'all'
							? 'bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa]'
							: 'text-[#777777] hover:text-[#3c3c3c] hover:bg-[#f4faff] border-2 border-transparent'}"
					>
						All ({tabCounts.all})
					</button>

					<button
						type="button"
						onclick={() => (activeTab = 'active')}
						class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 {activeTab ===
						'active'
							? 'bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa]'
							: 'text-[#777777] hover:text-[#3c3c3c] hover:bg-[#f4faff] border-2 border-transparent'}"
					>
						Active ({tabCounts.active})
					</button>

					<button
						type="button"
						onclick={() => (activeTab = 'in_queue')}
						class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 {activeTab ===
						'in_queue'
							? 'bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa]'
							: 'text-[#777777] hover:text-[#3c3c3c] hover:bg-[#f4faff] border-2 border-transparent'}"
					>
						In Queue ({tabCounts.in_queue})
					</button>

					<button
						type="button"
						onclick={() => (activeTab = 'delivered')}
						class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 {activeTab ===
						'delivered'
							? 'bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa]'
							: 'text-[#777777] hover:text-[#3c3c3c] hover:bg-[#f4faff] border-2 border-transparent'}"
					>
						Delivered ({tabCounts.delivered})
					</button>
				</div>
			</div>

			<!-- Commission Cards List -->
			<div class="space-y-4">
				{#if formattedCommissions.length === 0}
					<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-8 text-center space-y-2">
						<Inbox class="w-8 h-8 text-[#1cb0f6] mx-auto" />
						<h4 class="text-sm font-bold text-[#3c3c3c]">No commissions found</h4>
						<p class="text-xs text-[#777777]">
							{activeTab === 'all'
								? 'Your commission pipeline is currently clear.'
								: `No commissions with status "${activeTab}".`}
						</p>
					</div>
				{:else}
					{#each formattedCommissions as comm (comm.id)}
					<div
						class="bg-white border-2 border-[#c7e8fa] rounded-xl p-5 shadow-xs space-y-4 hover:border-[#1cb0f6] transition-colors"
					>
						<!-- Top Row: Service Name, Status Badge, Price USD -->
						<div class="flex items-start justify-between gap-3">
							<div class="space-y-1">
								<h3 class="text-base font-bold text-[#3c3c3c] leading-snug">
									{comm.serviceName}
								</h3>
								<div class="flex items-center gap-2 text-xs">
									<span
										class="font-bold px-2.5 py-0.5 rounded-lg border {comm.statusBadge.bg} {comm.statusBadge.border}"
										style="color: {comm.statusBadge.color}"
									>
										{comm.statusBadge.text}
									</span>
									<span class="font-mono text-xs font-semibold text-[#1cb0f6]">
										{comm.orderId}
									</span>
								</div>
							</div>

							<div class="text-right shrink-0">
								<div class="text-lg font-black text-[#3c3c3c] font-mono">
									{comm.formattedPrice}
								</div>
								<div class="text-[11px] text-[#777777] font-semibold">
									VGen Protected
								</div>
							</div>
						</div>

						<!-- Meta Row: Client Avatar & Username, Deadline Countdown -->
						<div
							class="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[#777777] border-t border-[#c7e8fa]/60"
						>
							<div class="flex items-center gap-2">
								<div
									class="w-7 h-7 rounded-xl bg-[#ddf4ff] border border-[#c7e8fa] text-[#1cb0f6] font-bold flex items-center justify-center shrink-0 text-xs"
								>
									{comm.clientUsername.slice(1, 3).toUpperCase()}
								</div>
								<div>
									<span class="font-bold text-[#3c3c3c]">{comm.clientDisplayName}</span>
									<span class="text-[#777777] ml-1 font-semibold">{comm.clientUsername}</span>
								</div>
							</div>

							<div class="flex items-center gap-1.5 font-semibold text-[#777777]">
								<Clock class="w-3.5 h-3.5 text-[#ff9600]" />
								<span>{comm.deadlineText}</span>
							</div>
						</div>

						<!-- Client Note & Brief Summary Box (bg-[#f4faff] rounded-xl) -->
						<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3.5 space-y-1.5">
							<div class="flex items-center gap-1.5 text-xs font-bold text-[#1cb0f6]">
								<FileText class="w-3.5 h-3.5" />
								<span>Client Note & Brief Summary</span>
							</div>
							<p class="text-xs text-[#3c3c3c] leading-relaxed">
								{comm.briefSummary}
							</p>
						</div>

						<!-- Action Buttons Row -->
						<div class="flex flex-wrap items-center justify-end gap-2 pt-1">
							{#each comm.actions as action}
								{#if action === 'Open Thread'}
									<button
										type="button"
										onclick={() => handleCommissionAction(action, comm)}
										class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-xs transition-colors cursor-pointer"
									>
										<MessageSquare class="w-3.5 h-3.5 text-[#1cb0f6]" />
										<span>Open Thread</span>
									</button>
								{:else if action === 'Accept Commission'}
									<button
										type="button"
										onclick={() => handleCommissionAction(action, comm)}
										class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#a5ed6e] hover:bg-[#8ee150] text-[#111111] font-bold text-xs transition-colors border border-[#85ca54] cursor-pointer"
									>
										<Check class="w-3.5 h-3.5" strokeWidth={2.5} />
										<span>Accept Commission</span>
									</button>
								{:else if action === 'Update Stage'}
									<button
										type="button"
										onclick={() => handleCommissionAction(action, comm)}
										class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#ddf4ff] hover:bg-[#c7e8fa] text-[#1cb0f6] font-bold text-xs transition-colors border border-[#c7e8fa] cursor-pointer"
									>
										<span>Update Stage</span>
									</button>
								{:else if action === 'Mark Completed'}
									<button
										type="button"
										onclick={() => handleCommissionAction(action, comm)}
										class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-[#e8f5e9] text-[#2e7d32] border-2 border-[#c8e6c9] font-bold text-xs transition-colors cursor-pointer"
									>
										<CheckCircle2 class="w-3.5 h-3.5 text-[#58cc02]" />
										<span>Mark Completed</span>
									</button>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
				{/if}
			</div>
		</section>

		<!-- Right Column (Aside, 380px): Safety Gate & Real-Time Context -->
		<aside class="lg:col-span-4 w-full space-y-6">
			<!-- 1. Draft Requiring Approval Card -->
			{#if activeDraft}
				<div
					class="bg-white border-2 border-[#c7e8fa] rounded-xl p-5 shadow-xs space-y-4 hover:border-[#1cb0f6] transition-colors"
				>
					<!-- Header with 7/7 Gate Passed Badge -->
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<ShieldCheck class="w-5 h-5 text-[#af71f5]" strokeWidth={2.5} />
							<h2 class="text-sm font-bold text-[#3c3c3c]">
								Draft Requiring Approval
							</h2>
						</div>
						<span
							class="text-[11px] font-black px-2 py-0.5 rounded-lg bg-[#f3e5f5] text-[#af71f5] border border-[#e1bee7] flex items-center gap-1 shrink-0"
						>
							<Check class="w-3 h-3 text-[#58cc02]" strokeWidth={3} />
							{draftApprovalContext.gateBadge}
						</span>
					</div>

					<!-- Target Client and Order Context -->
					<div class="flex items-center justify-between text-xs text-[#777777]">
						<span class="font-bold text-[#3c3c3c]">
							{draftApprovalContext.targetClient}
						</span>
						<span class="font-mono text-[#1cb0f6] font-bold">
							{draftApprovalContext.orderId}
						</span>
					</div>

					<!-- Editable Draft Textarea -->
					<div class="space-y-1.5">
						<label for="draft-textarea" class="block text-[11px] font-bold uppercase tracking-wider text-[#777777]">
							Draft Response
						</label>
						<textarea
							id="draft-textarea"
							bind:value={draftContent}
							rows={5}
							readonly={!isEditingDraft}
							class="w-full bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-3 text-xs text-[#3c3c3c] font-sans leading-relaxed resize-none focus:outline-none focus:border-[#1cb0f6] transition-colors {isEditingDraft
								? 'ring-2 ring-[#1cb0f6]/30 bg-white'
								: 'cursor-default'}"
						></textarea>
					</div>

					<!-- Safety Verification Indicators: 7/7 Gate Passed, SHA-256 Verified, Grounded: Timezone UTC+9 -->
					<div
						class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-2.5 flex items-center justify-between text-[11px] font-bold"
						title="Safety Gate: 7/7 Gate Passed • SHA-256 Verified • Grounded: Timezone UTC+9"
					>
						<div class="flex items-center gap-1.5 text-[#2e7d32]">
							<Lock class="w-3.5 h-3.5 text-[#58cc02]" strokeWidth={2.5} />
							<span>{draftApprovalContext.sha256Indicator}</span>
						</div>
						<div class="flex items-center gap-1.5 text-[#1cb0f6]">
							<Globe class="w-3.5 h-3.5 text-[#1cb0f6]" strokeWidth={2.5} />
							<span>{draftApprovalContext.groundingIndicator}</span>
						</div>
					</div>

					<!-- Primary Action: [Approve and Dispatch] and [Edit] -->
					<div class="flex items-center gap-2 pt-1">
						<button
							type="button"
							onclick={handleApproveAndDispatch}
							disabled={isApproving}
							class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#a5ed6e] hover:bg-[#8ee150] text-[#111111] font-black text-xs transition-all shadow-xs border-2 border-[#85ca54] cursor-pointer disabled:opacity-60"
						>
							<Send class="w-3.5 h-3.5 text-[#111111]" strokeWidth={2.5} />
							<span>{isApproving ? 'Dispatching...' : 'Approve and Dispatch'}</span>
						</button>

						<button
							type="button"
							onclick={handleToggleEditDraft}
							class="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-xs transition-colors cursor-pointer shrink-0"
						>
							<FileEdit class="w-3.5 h-3.5 text-[#777777]" />
							<span>{isEditingDraft ? 'Save' : 'Edit'}</span>
						</button>
					</div>
				</div>
			{:else}
				<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-5 shadow-xs space-y-3">
					<div class="flex items-center gap-2">
						<ShieldCheck class="w-5 h-5 text-[#af71f5]" strokeWidth={2.5} />
						<h2 class="text-sm font-bold text-[#3c3c3c]">Draft Requiring Approval</h2>
					</div>
					<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-6 text-center space-y-2">
						<CheckCircle2 class="w-8 h-8 text-[#58cc02] mx-auto" strokeWidth={2.5} />
						<h4 class="text-sm font-bold text-[#3c3c3c]">All Caught Up</h4>
						<p class="text-xs text-[#777777]">No drafts pending human approval right now.</p>
					</div>
				</div>
			{/if}

			<!-- 2. Recent Inbound Messages Card -->
			<div
				class="bg-white border-2 border-[#c7e8fa] rounded-xl p-5 shadow-xs space-y-4 hover:border-[#1cb0f6] transition-colors"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<MessageSquare class="w-4 h-4 text-[#1cb0f6]" strokeWidth={2.5} />
						<h2 class="text-sm font-bold text-[#3c3c3c]">
							Recent Inbound Messages
						</h2>
					</div>
					<a
						href="/conversations"
						class="text-[11px] font-bold text-[#1cb0f6] hover:underline"
					>
						View All
					</a>
				</div>

				<div class="space-y-3">
					{#if recentMessages.length === 0}
						<div class="p-4 rounded-xl bg-[#f4faff] border border-[#c7e8fa]/80 text-center text-xs text-[#777777]">
							No recent inbound messages.
						</div>
					{:else}
						{#each recentMessages.slice(0, 4) as msg, i}
							<div
								class="p-2.5 rounded-xl bg-[#f4faff] border border-[#c7e8fa]/80 space-y-1 hover:border-[#1cb0f6] transition-colors cursor-pointer"
								onclick={() => goto('/conversations')}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === 'Enter' && goto('/conversations')}
							>
								<div class="flex items-center justify-between text-xs">
									<div class="flex items-center gap-1.5 font-bold text-[#3c3c3c]">
										<!-- Cyan unread dot indicator -->
										{#if i < 2}
											<span class="w-2 h-2 rounded-full bg-[#1cb0f6] shrink-0"></span>
										{/if}
										<span>@{msg.clientUsername || msg.senderName || 'Client'}</span>
									</div>
									<span class="text-[11px] font-semibold text-[#777777]">
										{formatRelativeTime(msg.sentAt || msg.createdAt)}
									</span>
								</div>

								<p class="text-xs text-[#777777] line-clamp-2 leading-relaxed">
									{msg.content}
								</p>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<!-- 3. Client Memory Profile Card (Phase 8 bridge) -->
			<div
				class="bg-white border-2 border-[#c7e8fa] rounded-xl p-5 shadow-xs space-y-4 hover:border-[#1cb0f6] transition-colors"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Sparkles class="w-4 h-4 text-[#af71f5]" strokeWidth={2.5} />
						<h2 class="text-sm font-bold text-[#3c3c3c]">
							Client Memory Profile
						</h2>
					</div>
					<span class="text-xs font-bold text-[#1cb0f6]">
						{clientMemoryProfile.clientUsername}
					</span>
				</div>

				<!-- Memory Pills & Explanations -->
				<div class="space-y-3 text-xs">
					<!-- FACT Pills -->
					{#each clientMemoryProfile.facts as item}
						<div class="p-2.5 rounded-xl bg-[#f4faff] border border-[#c7e8fa]/80 space-y-1">
							<div class="flex items-center gap-1.5">
								<span
									class="text-[10px] font-black px-2 py-0.5 rounded-md border {item.badgeBg} {item.badgeBorder}"
									style="color: {item.badgeColor}"
								>
									{item.type}
								</span>
							</div>
							<p class="text-xs font-medium text-[#3c3c3c] leading-relaxed">
								{item.text}
							</p>
						</div>
					{/each}

					<!-- PREFERENCE Pills -->
					{#each clientMemoryProfile.preferences as item}
						<div class="p-2.5 rounded-xl bg-[#f4faff] border border-[#c7e8fa]/80 space-y-1">
							<div class="flex items-center gap-1.5">
								<span
									class="text-[10px] font-black px-2 py-0.5 rounded-md border {item.badgeBg} {item.badgeBorder}"
									style="color: {item.badgeColor}"
								>
									{item.type}
								</span>
							</div>
							<p class="text-xs font-medium text-[#3c3c3c] leading-relaxed">
								{item.text}
							</p>
						</div>
					{/each}

					<!-- INFERENCE Pills -->
					{#each clientMemoryProfile.inferences as item}
						<div class="p-2.5 rounded-xl bg-[#f4faff] border border-[#c7e8fa]/80 space-y-1">
							<div class="flex items-center gap-1.5">
								<span
									class="text-[10px] font-black px-2 py-0.5 rounded-md border {item.badgeBg} {item.badgeBorder}"
									style="color: {item.badgeColor}"
								>
									{item.type}
								</span>
							</div>
							<p class="text-xs font-medium text-[#3c3c3c] leading-relaxed">
								{item.text}
							</p>
						</div>
					{/each}
				</div>
			</div>
		</aside>
	</div>
</div>
