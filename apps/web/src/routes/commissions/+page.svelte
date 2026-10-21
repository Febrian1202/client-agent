<script lang="ts">
	import { onMount } from 'svelte';
	import {
		api,
		type CommissionItem
	} from '$lib/api';
	import {
		DEFAULT_SAMPLE_COMMISSIONS,
		formatCommissionCard,
		type FormattedCommission
	} from '$lib/dashboard';
	import {
		Briefcase,
		Search,
		RefreshCw,
		Clock,
		ExternalLink,
		MessageSquare,
		CheckCircle2,
		AlertCircle,
		ChevronRight,
		Check,
		Sparkles,
		X
	} from 'lucide-svelte';

	type PipelineTab = 'all' | 'requested' | 'accepted' | 'in_progress' | 'delivered' | 'completed';

	interface StatusFilterTab {
		id: PipelineTab;
		label: string;
	}

	const pipelineTabs: StatusFilterTab[] = [
		{ id: 'all', label: 'All' },
		{ id: 'requested', label: 'Requested' },
		{ id: 'accepted', label: 'Accepted' },
		{ id: 'in_progress', label: 'In Progress' },
		{ id: 'delivered', label: 'Delivered' },
		{ id: 'completed', label: 'Completed' }
	];

	let rawCommissions = $state<CommissionItem[]>([]);
	let activeTab = $state<PipelineTab>('all');
	let searchQuery = $state('');
	let isLoading = $state(true);
	let isRefreshing = $state(false);
	let updatingId = $state<number | null>(null);

	// Stage update modal state
	let stageModalCommission = $state<CommissionItem | null>(null);
	let targetStage = $state<string>('in_progress');

	// Toast state
	let toastMessage = $state<string | null>(null);
	let toastType = $state<'success' | 'error'>('success');
	let toastTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		if (toastTimeout) clearTimeout(toastTimeout);
		toastMessage = message;
		toastType = type;
		toastTimeout = setTimeout(() => {
			toastMessage = null;
		}, 4000);
	}

	async function loadCommissions() {
		try {
			const res = await api.listCommissions();
			if (res && res.length > 0) {
				rawCommissions = res;
			} else {
				rawCommissions = DEFAULT_SAMPLE_COMMISSIONS;
			}
		} catch {
			rawCommissions = DEFAULT_SAMPLE_COMMISSIONS;
		} finally {
			isLoading = false;
			isRefreshing = false;
		}
	}

	async function handleRefresh() {
		isRefreshing = true;
		await loadCommissions();
	}

	onMount(() => {
		loadCommissions();
	});

	// Filter commissions by status tab and search query
	const filteredCommissions = $derived.by(() => {
		return rawCommissions.filter((comm) => {
			const s = (comm.status || 'requested').toLowerCase();

			// Status tab match
			if (activeTab === 'requested') {
				if (s !== 'requested' && s !== 'in_queue') return false;
			} else if (activeTab === 'accepted') {
				if (s !== 'accepted') return false;
			} else if (activeTab === 'in_progress') {
				if (s !== 'in_progress' && s !== 'paid' && s !== 'active') return false;
			} else if (activeTab === 'delivered') {
				if (s !== 'delivered') return false;
			} else if (activeTab === 'completed') {
				if (s !== 'completed') return false;
			}

			// Search query match
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase().trim();
				const service = (comm.serviceName || '').toLowerCase();
				const client = (comm.clientUsername || '').toLowerCase();
				const display = (comm.clientDisplayName || '').toLowerCase();
				const orderId = (comm.externalId || '').toLowerCase();
				if (!service.includes(q) && !client.includes(q) && !display.includes(q) && !orderId.includes(q)) {
					return false;
				}
			}

			return true;
		});
	});

	const formattedCards = $derived(filteredCommissions.map((c) => formatCommissionCard(c)));

	// Tab counts computed from rawCommissions
	const tabCounts = $derived({
		all: rawCommissions.length,
		requested: rawCommissions.filter((c) => ['requested', 'in_queue'].includes((c.status || '').toLowerCase())).length,
		accepted: rawCommissions.filter((c) => (c.status || '').toLowerCase() === 'accepted').length,
		in_progress: rawCommissions.filter((c) => ['in_progress', 'paid', 'active'].includes((c.status || '').toLowerCase())).length,
		delivered: rawCommissions.filter((c) => (c.status || '').toLowerCase() === 'delivered').length,
		completed: rawCommissions.filter((c) => (c.status || '').toLowerCase() === 'completed').length
	});

	async function handleAccept(comm: CommissionItem) {
		updatingId = comm.id;
		try {
			await api.updateCommission(comm.id, { status: 'accepted' });
			// Update local state
			rawCommissions = rawCommissions.map((c) => (c.id === comm.id ? { ...c, status: 'accepted' } : c));
			showToast(`Commission #${comm.id} accepted successfully`, 'success');
		} catch (err: any) {
			showToast(err.message || 'Failed to accept commission', 'error');
		} finally {
			updatingId = null;
		}
	}

	async function handleMarkCompleted(comm: CommissionItem) {
		updatingId = comm.id;
		try {
			await api.updateCommission(comm.id, { status: 'completed' });
			// Update local state
			rawCommissions = rawCommissions.map((c) => (c.id === comm.id ? { ...c, status: 'completed' } : c));
			showToast(`Commission #${comm.id} marked as completed`, 'success');
		} catch (err: any) {
			showToast(err.message || 'Failed to complete commission', 'error');
		} finally {
			updatingId = null;
		}
	}

	function openStageModal(comm: CommissionItem) {
		stageModalCommission = comm;
		targetStage = comm.status || 'in_progress';
	}

	async function saveStageUpdate() {
		if (!stageModalCommission) return;
		const id = stageModalCommission.id;
		updatingId = id;
		try {
			await api.updateCommission(id, { status: targetStage });
			rawCommissions = rawCommissions.map((c) => (c.id === id ? { ...c, status: targetStage } : c));
			showToast(`Stage updated to ${targetStage}`, 'success');
			stageModalCommission = null;
		} catch (err: any) {
			showToast(err.message || 'Failed to update stage', 'error');
		} finally {
			updatingId = null;
		}
	}

	function getInitial(name?: string | null): string {
		if (!name) return '?';
		const clean = name.replace(/^@/, '').trim();
		return clean.charAt(0).toUpperCase() || '?';
	}
</script>

<svelte:head>
	<title>Commissions Pipeline | ClientAgent</title>
</svelte:head>

<div class="min-h-screen bg-[#ddf4ff] p-6 space-y-6">
	<!-- Toast Notification -->
	{#if toastMessage}
		<div
			class="fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border-2 shadow-lg flex items-center gap-3 transition-all {toastType === 'success' ? 'bg-[#e8f5e9] border-[#c8e6c9] text-[#2e7d32]' : 'bg-[#ffebee] border-[#ffcdd2] text-[#c62828]'}"
		>
			{#if toastType === 'success'}
				<CheckCircle2 class="w-5 h-5 text-[#2e7d32]" />
			{:else}
				<AlertCircle class="w-5 h-5 text-[#c62828]" />
			{/if}
			<span class="text-sm font-bold">{toastMessage}</span>
		</div>
	{/if}

	<!-- Header Bar -->
	<header
		class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
	>
		<div class="flex items-center gap-4">
			<div
				class="w-12 h-12 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]"
			>
				<Briefcase class="w-6 h-6" />
			</div>
			<div>
				<h1 class="text-2xl font-black text-[#3c3c3c] tracking-tight">Commission Pipeline</h1>
				<p class="text-sm text-[#777777]">
					Track client orders, USD pricing, delivery commitments, and project stages
				</p>
			</div>
		</div>

		<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={handleRefresh}
				disabled={isRefreshing}
				class="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-sm hover:bg-[#f4faff] active:scale-95 transition cursor-pointer disabled:opacity-50"
			>
				<RefreshCw class="w-4 h-4 {isRefreshing ? 'animate-spin text-[#1cb0f6]' : ''}" />
				Refresh
			</button>
		</div>
	</header>

	<!-- Status Tabs Bar -->
	<div class="flex flex-wrap items-center gap-2">
		{#each pipelineTabs as tab}
			{@const count = tabCounts[tab.id]}
			<button
				type="button"
				onclick={() => (activeTab = tab.id)}
				class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer {activeTab === tab.id ? 'bg-[#1cb0f6] text-white shadow-sm' : 'bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] hover:bg-[#f4faff]'}"
			>
				<span>{tab.label}</span>
				<span
					class="px-2 py-0.5 rounded-full text-xs font-bold {activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-[#ddf4ff] text-[#1cb0f6]'}"
				>
					{count}
				</span>
			</button>
		{/each}
	</div>

	<!-- Search & Metrics Filter Bar -->
	<div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
		<div class="relative flex-1 max-w-md">
			<Search class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#777777]" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search by client, service, or order ID..."
				class="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#c7e8fa] rounded-xl text-sm text-[#3c3c3c] placeholder:text-[#777777] focus:outline-none focus:border-[#1cb0f6] transition shadow-sm font-medium"
			/>
		</div>

		<div class="text-xs font-bold text-[#777777]">
			Showing {formattedCards.length} of {rawCommissions.length} commissions
		</div>
	</div>

	<!-- Pipeline Cards -->
	{#if isLoading}
		<div
			class="bg-white border-2 border-[#c7e8fa] rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3"
		>
			<RefreshCw class="w-8 h-8 text-[#1cb0f6] animate-spin" />
			<p class="text-sm font-bold text-[#777777]">Loading commission pipeline...</p>
		</div>
	{:else if formattedCards.length === 0}
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-12 text-center">
			<Briefcase class="w-12 h-12 text-[#c7e8fa] mx-auto mb-3" />
			<h3 class="text-base font-bold text-[#3c3c3c] mb-1">No commissions found</h3>
			<p class="text-xs text-[#777777]">
				{#if searchQuery}
					No commission orders match "{searchQuery}".
				{:else}
					No commissions currently in the "{activeTab}" stage.
				{/if}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
			{#each formattedCards as card (card.id)}
				<div
					class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm flex flex-col justify-between gap-5 hover:border-[#1cb0f6] transition"
				>
					<!-- Top Section: Service, Price & Order ID -->
					<div class="space-y-2">
						<div class="flex items-start justify-between gap-4">
							<div>
								<span class="text-xs font-extrabold text-[#777777] uppercase tracking-wider">
									{card.orderId}
								</span>
								<h2 class="text-lg font-black text-[#3c3c3c] leading-snug">
									{card.serviceName}
								</h2>
							</div>

							<div class="text-right">
								<span class="text-lg font-black text-[#3c3c3c]">
									{card.formattedPrice}
								</span>
								<div class="mt-1">
									<span
										class="px-2.5 py-0.5 text-xs font-bold rounded-lg border {card.statusBadge.bg} {card.statusBadge.border}"
										style="color: {card.statusBadge.color}"
									>
										{card.statusBadge.text}
									</span>
								</div>
							</div>
						</div>

						<!-- Client & Deadline Info -->
						<div class="flex items-center justify-between gap-3 pt-2 text-xs flex-wrap">
							<div class="flex items-center gap-2">
								{#if card.clientAvatarUrl}
									<img
										src={card.clientAvatarUrl}
										alt={card.clientDisplayName}
										class="w-6 h-6 rounded-full object-cover border border-[#c7e8fa]"
									/>
								{:else}
									<div
										class="w-6 h-6 rounded-full bg-[#ddf4ff] border border-[#c7e8fa] text-[#1cb0f6] font-bold text-xs flex items-center justify-center"
									>
										{getInitial(card.clientDisplayName || card.clientUsername)}
									</div>
								{/if}
								<span class="font-bold text-[#3c3c3c]">{card.clientDisplayName}</span>
								<span class="text-[#777777] font-medium">{card.clientUsername}</span>
							</div>

							<div class="flex items-center gap-1.5 font-bold text-[#777777]">
								<Clock class="w-3.5 h-3.5 text-[#1cb0f6]" />
								<span>{card.deadlineText}</span>
							</div>
						</div>
					</div>

					<!-- Client Note & Brief Summary Box (bg-[#f4faff] rounded-xl) -->
					<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-1.5">
						<div class="flex items-center gap-1.5 text-xs font-bold text-[#1cb0f6]">
							<Sparkles class="w-3.5 h-3.5" />
							<span>Client Brief & Notes</span>
						</div>
						<p class="text-xs text-[#3c3c3c] leading-relaxed">
							{card.briefSummary}
						</p>
					</div>

					<!-- Action Buttons Row -->
					<div class="flex items-center gap-2 pt-2 border-t border-[#f4faff] flex-wrap">
						<!-- Open Thread button -->
						<a
							href="/conversations?client={card.clientUsername.replace(/^@/, '')}"
							class="inline-flex items-center gap-1.5 px-3 py-2 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-xs hover:bg-[#f4faff] hover:border-[#1cb0f6] transition cursor-pointer"
						>
							<MessageSquare class="w-3.5 h-3.5 text-[#1cb0f6]" />
							Open Thread
						</a>

						<!-- Contextual Action Buttons -->
						{#if card.raw.status === 'requested' || card.raw.status === 'in_queue'}
							<button
								type="button"
								onclick={() => handleAccept(card.raw)}
								disabled={updatingId === card.id}
								class="inline-flex items-center gap-1.5 px-3 py-2 bg-[#a5ed6e] text-[#1b4332] border-2 border-[#8ee052] rounded-xl font-black text-xs hover:bg-[#8ee052] transition cursor-pointer disabled:opacity-50"
							>
								<Check class="w-3.5 h-3.5" />
								Accept
							</button>
						{/if}

						<button
							type="button"
							onclick={() => openStageModal(card.raw)}
							disabled={updatingId === card.id}
							class="inline-flex items-center gap-1.5 px-3 py-2 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-xs hover:bg-[#f4faff] hover:border-[#1cb0f6] transition cursor-pointer disabled:opacity-50"
						>
							Update Stage
						</button>

						{#if card.raw.status !== 'completed'}
							<button
								type="button"
								onclick={() => handleMarkCompleted(card.raw)}
								disabled={updatingId === card.id}
								class="inline-flex items-center gap-1.5 px-3 py-2 bg-[#e8f5e9] text-[#2e7d32] border-2 border-[#c8e6c9] rounded-xl font-black text-xs hover:bg-[#c8e6c9] transition cursor-pointer disabled:opacity-50"
							>
								<CheckCircle2 class="w-3.5 h-3.5" />
								Mark Completed
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Stage Update Modal Dialog -->
	{#if stageModalCommission}
		<div
			class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
		>
			<div
				class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 max-w-md w-full shadow-xl space-y-4"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-base font-black text-[#3c3c3c]">
						Update Stage: {stageModalCommission.serviceName}
					</h3>
					<button
						type="button"
						onclick={() => (stageModalCommission = null)}
						class="p-1 text-[#777777] hover:text-[#3c3c3c] cursor-pointer"
					>
						<X class="w-4 h-4" />
					</button>
				</div>

				<div class="space-y-2">
					<label for="stage-select" class="block text-xs font-bold text-[#777777]">Select Progress Stage</label>
					<select
						id="stage-select"
						bind:value={targetStage}
						class="w-full px-3 py-2 bg-white border-2 border-[#c7e8fa] rounded-xl text-sm font-semibold text-[#3c3c3c] focus:outline-none focus:border-[#1cb0f6]"
					>
						<option value="requested">Requested</option>
						<option value="accepted">Accepted</option>
						<option value="in_progress">In Progress</option>
						<option value="delivered">Delivered</option>
						<option value="completed">Completed</option>
					</select>
				</div>

				<div class="flex items-center justify-end gap-3 pt-3 border-t border-[#f4faff]">
					<button
						type="button"
						onclick={() => (stageModalCommission = null)}
						class="px-4 py-2 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-xs hover:bg-[#f4faff] cursor-pointer"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={saveStageUpdate}
						disabled={updatingId === stageModalCommission.id}
						class="px-4 py-2 bg-[#1cb0f6] text-white rounded-xl font-black text-xs hover:bg-[#1899d6] transition cursor-pointer disabled:opacity-50"
					>
						Save Stage
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
