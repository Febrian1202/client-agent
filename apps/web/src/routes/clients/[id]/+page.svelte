<script lang="ts">
	import { page } from '$app/state';
	import { api, type ClientItem, type CommissionItem } from '$lib/api';
	import {
		DEFAULT_SAMPLE_CLIENTS,
		DEFAULT_SAMPLE_COMMISSIONS,
		getClientMemoryProfile,
		formatRelativeTime
	} from '$lib/dashboard';
	import {
		ArrowLeft,
		Users,
		ExternalLink,
		MessageSquare,
		Calendar,
		Clock,
		ShieldCheck,
		Sparkles,
		Briefcase,
		CheckCircle2,
		AlertCircle,
		DollarSign,
		Bookmark
	} from 'lucide-svelte';

	let client = $state<ClientItem | null>(null);
	let commissions = $state<CommissionItem[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state<string | null>(null);

	const clientId = $derived(Number(page.params.id));

	async function loadClientData() {
		isLoading = true;
		errorMessage = null;

		if (Number.isNaN(clientId) || clientId <= 0) {
			errorMessage = 'Invalid client ID';
			isLoading = false;
			return;
		}

		try {
			// Fetch client details
			try {
				const clientRes = await api.getClient(clientId);
				client = clientRes;
			} catch (err: any) {
				// Fallback to sample data for preview or offline dev if client ID matches sample
				const fallback = DEFAULT_SAMPLE_CLIENTS.find((c) => c.id === clientId);
				if (fallback) {
					client = fallback;
				} else {
					client = null;
					errorMessage = err.message || 'Client not found';
					return;
				}
			}

			// Fetch commissions for this client
			try {
				const commRes = await api.listCommissions({ clientId });
				if (commRes && commRes.length > 0) {
					commissions = commRes;
				} else {
					commissions = DEFAULT_SAMPLE_COMMISSIONS.filter(
						(c) =>
							c.clientId === clientId ||
							c.clientUsername?.toLowerCase() === client?.username.toLowerCase()
					);
				}
			} catch {
				commissions = DEFAULT_SAMPLE_COMMISSIONS.filter(
					(c) =>
						c.clientId === clientId ||
						c.clientUsername?.toLowerCase() === client?.username.toLowerCase()
				);
			}
		} catch (err: any) {
			errorMessage = err.message || 'Failed to load client details';
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (page.params.id) {
			loadClientData();
		}
	});

	const memoryProfile = $derived(getClientMemoryProfile(client?.username));

	function formatDate(dateVal?: string | Date | null): string {
		if (!dateVal) return 'Not specified';
		try {
			const d = new Date(dateVal);
			return d.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return String(dateVal);
		}
	}

	function getInitial(name?: string | null): string {
		if (!name) return '?';
		const clean = name.replace(/^@/, '').trim();
		return clean.charAt(0).toUpperCase() || '?';
	}

	function getStatusBadge(status?: string) {
		const s = (status || 'requested').toLowerCase();
		if (s === 'completed') {
			return { label: 'Completed', color: '#58cc02', bg: 'bg-[#e8f5e9]', border: 'border-[#c8e6c9]' };
		}
		if (s === 'delivered') {
			return { label: 'Delivered', color: '#1cb0f6', bg: 'bg-[#ddf4ff]', border: 'border-[#c7e8fa]' };
		}
		if (s === 'in_progress' || s === 'accepted') {
			return { label: 'In Progress', color: '#2e7d32', bg: 'bg-[#e8f5e9]', border: 'border-[#c8e6c9]' };
		}
		return { label: 'Requested', color: '#ff9600', bg: 'bg-[#fff3e0]', border: 'border-[#ffe0b2]' };
	}
</script>

<svelte:head>
	<title>
		{client ? `${client.displayName || client.username} | Clients` : 'Client Profile'} | ClientAgent
	</title>
</svelte:head>

<div class="min-h-screen bg-[#ddf4ff] p-6 space-y-6">
	<!-- Navigation Breadcrumb / Back button -->
	<div>
		<a
			href="/clients"
			class="inline-flex items-center gap-2 text-xs font-bold text-[#1cb0f6] bg-white border-2 border-[#c7e8fa] px-3.5 py-2 rounded-xl hover:bg-[#f4faff] transition active:scale-95 shadow-sm"
		>
			<ArrowLeft class="w-4 h-4" />
			Back to Clients
		</a>
	</div>

	{#if isLoading}
		<div
			class="bg-white border-2 border-[#c7e8fa] rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3"
		>
			<Clock class="w-8 h-8 text-[#1cb0f6] animate-spin" />
			<p class="text-sm font-bold text-[#777777]">Loading client profile...</p>
		</div>
	{:else if errorMessage || !client}
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-8 text-center max-w-lg mx-auto">
			<AlertCircle class="w-10 h-10 text-[#ff4b4b] mx-auto mb-3" />
			<h2 class="text-base font-black text-[#3c3c3c] mb-1">Client Not Found</h2>
			<p class="text-xs text-[#777777] mb-4">
				{errorMessage || 'The requested client record does not exist or could not be loaded.'}
			</p>
			<a
				href="/clients"
				class="inline-flex items-center gap-2 px-4 py-2 bg-[#1cb0f6] text-white rounded-xl font-bold text-xs hover:bg-[#1899d6] transition"
			>
				Return to Directory
			</a>
		</div>
	{:else}
		<!-- Client Profile Header Card -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
				<!-- Identity -->
				<div class="flex items-center gap-4">
					{#if client.avatarUrl}
						<img
							src={client.avatarUrl}
							alt={client.displayName || client.username}
							class="w-16 h-16 rounded-full object-cover border-2 border-[#c7e8fa] shadow-sm"
						/>
					{:else}
						<div
							class="w-16 h-16 rounded-full bg-[#ddf4ff] border-2 border-[#c7e8fa] text-[#1cb0f6] font-black text-2xl flex items-center justify-center shadow-sm"
						>
							{getInitial(client.displayName || client.username)}
						</div>
					{/if}

					<div>
						<div class="flex items-center gap-2.5 flex-wrap">
							<h1 class="text-2xl font-black text-[#3c3c3c] tracking-tight">
								{client.displayName || client.username}
							</h1>
							<span
								class="px-2.5 py-0.5 text-xs font-bold uppercase rounded-lg bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]"
							>
								{client.platform || 'vgen'}
							</span>
						</div>
						<p class="text-sm font-semibold text-[#777777] mt-0.5">
							@{client.username.replace(/^@/, '')}
						</p>
					</div>
				</div>

				<!-- Quick External Actions -->
				<div class="flex items-center gap-3 flex-wrap">
					<a
						href="https://vgen.co/{client.username.replace(/^@/, '')}"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-xs hover:bg-[#f4faff] hover:border-[#1cb0f6] transition cursor-pointer"
					>
						<ExternalLink class="w-4 h-4 text-[#1cb0f6]" />
						Open on VGen
					</a>

					<a
						href="/conversations?client={client.username.replace(/^@/, '')}"
						class="inline-flex items-center gap-2 px-4 py-2.5 bg-[#a5ed6e] text-[#1b4332] border-2 border-[#8ee052] rounded-xl font-black text-xs hover:bg-[#8ee052] transition cursor-pointer shadow-sm active:scale-95"
					>
						<MessageSquare class="w-4 h-4" />
						Open Thread
					</a>
				</div>
			</div>

			<!-- Metadata Pills Row -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-[#f4faff]">
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<Calendar class="w-3.5 h-3.5 text-[#1cb0f6]" />
						First Seen
					</p>
					<p class="text-sm font-black text-[#3c3c3c] mt-1">{formatDate(client.firstSeenAt)}</p>
				</div>

				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<Clock class="w-3.5 h-3.5 text-[#1cb0f6]" />
						Last Seen
					</p>
					<p class="text-sm font-black text-[#3c3c3c] mt-1">{formatDate(client.lastSeenAt)}</p>
				</div>

				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<Briefcase class="w-3.5 h-3.5 text-[#1cb0f6]" />
						Total Commissions
					</p>
					<p class="text-sm font-black text-[#3c3c3c] mt-1">
						{commissions.length} {commissions.length === 1 ? 'Order' : 'Orders'}
					</p>
				</div>

				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3">
					<p class="text-xs text-[#777777] font-semibold flex items-center gap-1.5">
						<DollarSign class="w-3.5 h-3.5 text-[#1cb0f6]" />
						Platform Status
					</p>
					<p class="text-sm font-black text-[#58cc02] mt-1">Active Client</p>
				</div>
			</div>
		</div>

		<!-- Client Memory Profile Card -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm space-y-5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-xl bg-[#f3e5f5] border-2 border-[#e1bee7] flex items-center justify-center text-[#af71f5]"
					>
						<Sparkles class="w-5 h-5" />
					</div>
					<div>
						<h2 class="text-lg font-black text-[#3c3c3c] tracking-tight">
							Client Memory & Intelligence
						</h2>
						<p class="text-xs text-[#777777]">
							Structured memory tags partitioned by epistemic certainty
						</p>
					</div>
				</div>
			</div>

			<!-- Memory Clusters -->
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				<!-- Facts Column -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-3">
					<div class="flex items-center gap-2">
						<span
							class="px-2 py-0.5 text-xs font-black rounded-lg bg-[#e8f5e9] text-[#58cc02] border border-[#c8e6c9]"
						>
							FACT
						</span>
						<span class="text-xs font-bold text-[#777777]">Verified Truths</span>
					</div>
					<div class="space-y-2">
						{#each memoryProfile.facts as item}
							<div
								class="p-2.5 bg-white border border-[#c8e6c9] rounded-lg text-xs font-semibold text-[#3c3c3c] shadow-xs"
							>
								{item.text}
							</div>
						{/each}
					</div>
				</div>

				<!-- Preferences Column -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-3">
					<div class="flex items-center gap-2">
						<span
							class="px-2 py-0.5 text-xs font-black rounded-lg bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]"
						>
							PREFERENCE
						</span>
						<span class="text-xs font-bold text-[#777777]">Observed Habits</span>
					</div>
					<div class="space-y-2">
						{#each memoryProfile.preferences as item}
							<div
								class="p-2.5 bg-white border border-[#c7e8fa] rounded-lg text-xs font-semibold text-[#3c3c3c] shadow-xs"
							>
								{item.text}
							</div>
						{/each}
					</div>
				</div>

				<!-- Inferences Column -->
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-4 space-y-3">
					<div class="flex items-center gap-2">
						<span
							class="px-2 py-0.5 text-xs font-black rounded-lg bg-[#f3e5f5] text-[#af71f5] border border-[#e1bee7]"
						>
							INFERENCE
						</span>
						<span class="text-xs font-bold text-[#777777]">AI Hypotheses</span>
					</div>
					<div class="space-y-2">
						{#each memoryProfile.inferences as item}
							<div
								class="p-2.5 bg-white border border-[#e1bee7] rounded-lg text-xs font-semibold text-[#3c3c3c] shadow-xs"
							>
								{item.text}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Commission History Section -->
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm space-y-5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]"
					>
						<Briefcase class="w-5 h-5" />
					</div>
					<div>
						<h2 class="text-lg font-black text-[#3c3c3c] tracking-tight">Commission History</h2>
						<p class="text-xs text-[#777777]">Past and active commission orders for this client</p>
					</div>
				</div>

				<span
					class="px-3 py-1 bg-[#f4faff] border border-[#c7e8fa] text-xs font-bold text-[#3c3c3c] rounded-xl"
				>
					{commissions.length} {commissions.length === 1 ? 'order' : 'orders'}
				</span>
			</div>

			{#if commissions.length === 0}
				<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-8 text-center">
					<Briefcase class="w-10 h-10 text-[#c7e8fa] mx-auto mb-2" />
					<p class="text-xs font-bold text-[#777777]">No commission records for this client yet.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each commissions as comm (comm.id)}
						{@const badge = getStatusBadge(comm.status)}
						<div
							class="bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-[#1cb0f6] transition"
						>
							<div class="space-y-1">
								<div class="flex items-center gap-2.5 flex-wrap">
									<h3 class="text-sm font-black text-[#3c3c3c]">{comm.serviceName}</h3>
									<span
										class="px-2 py-0.5 text-xs font-bold rounded-lg border {badge.bg} {badge.border}"
										style="color: {badge.color}"
									>
										{badge.label}
									</span>
									<span class="text-xs font-bold text-[#777777]">
										{comm.externalId ? `#${comm.externalId.replace(/^#/, '')}` : `#VG-${comm.id}`}
									</span>
								</div>

								<div class="flex items-center gap-4 text-xs text-[#777777] flex-wrap">
									<span>
										Amount:
										<strong class="text-[#3c3c3c]">
											${parseFloat(comm.amount || '0').toFixed(2)}
											{comm.currency || 'USD'}
										</strong>
									</span>
									<span class="flex items-center gap-1">
										<Clock class="w-3.5 h-3.5 text-[#1cb0f6]" />
										Delivery:
										<strong class="text-[#3c3c3c]">{formatDate(comm.guaranteedDelivery)}</strong>
									</span>
								</div>
							</div>

							<div class="flex items-center gap-2">
								<a
									href="/commissions"
									class="px-3 py-1.5 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl text-xs font-bold hover:bg-[#ddf4ff] hover:border-[#1cb0f6] transition"
								>
									View on Board
								</a>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
