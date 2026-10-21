<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type ClientItem } from '$lib/api';
	import { DEFAULT_SAMPLE_CLIENTS } from '$lib/dashboard';
	import {
		Users,
		Search,
		RefreshCw,
		ExternalLink,
		MessageSquare,
		Calendar,
		ArrowRight,
		Clock,
		Sparkles
	} from 'lucide-svelte';

	let clients = $state<ClientItem[]>([]);
	let searchQuery = $state('');
	let isLoading = $state(true);
	let isRefreshing = $state(false);

	async function loadClients() {
		try {
			const cleanQuery = searchQuery.trim().replace(/^@/, '');
			const res = await api.listClients({ search: cleanQuery || undefined });
			if (res && res.length > 0) {
				clients = res;
			} else if (!cleanQuery) {
				clients = DEFAULT_SAMPLE_CLIENTS;
			} else {
				clients = [];
			}
		} catch {
			clients = DEFAULT_SAMPLE_CLIENTS;
		} finally {
			isLoading = false;
			isRefreshing = false;
		}
	}

	async function handleRefresh() {
		isRefreshing = true;
		await loadClients();
	}

	onMount(() => {
		loadClients();
	});

	const filteredClients = $derived(
		clients.filter((client) => {
			if (!searchQuery.trim()) return true;
			const q = searchQuery.trim().toLowerCase().replace(/^@/, '');
			const u = (client.username || '').toLowerCase().replace(/^@/, '');
			const d = (client.displayName || '').toLowerCase();
			const p = (client.platform || '').toLowerCase();
			return u.includes(q) || d.includes(q) || p.includes(q);
		})
	);

	function formatDate(dateVal?: string | Date | null): string {
		if (!dateVal) return 'Unknown';
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
</script>

<svelte:head>
	<title>Clients | ClientAgent</title>
</svelte:head>

<div class="min-h-screen bg-[#ddf4ff] p-6 space-y-6">
	<!-- Header Bar -->
	<header
		class="bg-white border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
	>
		<div class="flex items-center gap-4">
			<div
				class="w-12 h-12 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]"
			>
				<Users class="w-6 h-6" />
			</div>
			<div>
				<h1 class="text-2xl font-black text-[#3c3c3c] tracking-tight">Client Directory</h1>
				<p class="text-sm text-[#777777]">
					Browse VGen clients, relationship history, and intelligence profiles
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

	<!-- Search & Metrics Bar -->
	<div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
		<div class="relative flex-1 max-w-md">
			<Search class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#777777]" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search clients by name or username..."
				class="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#c7e8fa] rounded-xl text-sm text-[#3c3c3c] placeholder:text-[#777777] focus:outline-none focus:border-[#1cb0f6] transition shadow-sm font-medium"
			/>
		</div>

		<div class="flex items-center gap-2 text-xs font-bold text-[#777777]">
			<span class="px-3 py-1.5 bg-white border-2 border-[#c7e8fa] rounded-xl text-[#3c3c3c]">
				{filteredClients.length} {filteredClients.length === 1 ? 'Client' : 'Clients'}
			</span>
		</div>
	</div>

	<!-- Clients Grid -->
	{#if isLoading}
		<div
			class="bg-white border-2 border-[#c7e8fa] rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3"
		>
			<RefreshCw class="w-8 h-8 text-[#1cb0f6] animate-spin" />
			<p class="text-sm font-bold text-[#777777]">Loading clients...</p>
		</div>
	{:else if filteredClients.length === 0}
		<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-12 text-center">
			<Users class="w-12 h-12 text-[#c7e8fa] mx-auto mb-3" />
			<h3 class="text-base font-bold text-[#3c3c3c] mb-1">No clients found</h3>
			<p class="text-xs text-[#777777]">
				{#if searchQuery}
					No client matches your search filter "{searchQuery}".
				{:else}
					No client records have been registered yet.
				{/if}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
			{#each filteredClients as client (client.id)}
				<div
					class="bg-white border-2 border-[#c7e8fa] rounded-xl p-5 shadow-sm hover:border-[#1cb0f6] transition flex flex-col justify-between gap-4"
				>
					<!-- Top Row: Avatar & Identity -->
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-center gap-3">
							{#if client.avatarUrl}
								<img
									src={client.avatarUrl}
									alt={client.displayName || client.username}
									class="w-12 h-12 rounded-full object-cover border-2 border-[#c7e8fa]"
								/>
							{:else}
								<div
									class="w-12 h-12 rounded-full bg-[#ddf4ff] border-2 border-[#c7e8fa] text-[#1cb0f6] font-black text-lg flex items-center justify-center"
								>
									{getInitial(client.displayName || client.username)}
								</div>
							{/if}
							<div>
								<h2 class="text-base font-black text-[#3c3c3c] leading-tight">
									{client.displayName || client.username}
								</h2>
								<p class="text-xs font-semibold text-[#777777]">
									@{client.username.replace(/^@/, '')}
								</p>
							</div>
						</div>

						<span
							class="px-2.5 py-0.5 text-xs font-bold uppercase rounded-lg bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]"
						>
							{client.platform || 'vgen'}
						</span>
					</div>

					<!-- Timestamps / Metadata -->
					<div class="bg-[#f4faff] border border-[#c7e8fa] rounded-xl p-3 space-y-1.5 text-xs">
						<div class="flex items-center justify-between text-[#777777]">
							<span class="flex items-center gap-1.5">
								<Calendar class="w-3.5 h-3.5 text-[#1cb0f6]" />
								First seen
							</span>
							<span class="font-bold text-[#3c3c3c]">{formatDate(client.firstSeenAt)}</span>
						</div>
						<div class="flex items-center justify-between text-[#777777]">
							<span class="flex items-center gap-1.5">
								<Clock class="w-3.5 h-3.5 text-[#1cb0f6]" />
								Last seen
							</span>
							<span class="font-bold text-[#3c3c3c]">{formatDate(client.lastSeenAt)}</span>
						</div>
					</div>

					<!-- Actions -->
					<div class="flex items-center gap-2 pt-1 border-t border-[#f4faff]">
						<a
							href="/clients/{client.id}"
							class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border-2 border-[#c7e8fa] text-[#3c3c3c] rounded-xl font-bold text-xs hover:bg-[#f4faff] hover:border-[#1cb0f6] transition text-center cursor-pointer"
						>
							View Profile
							<ArrowRight class="w-3.5 h-3.5 text-[#1cb0f6]" />
						</a>

						<a
							href="/conversations?client={client.username.replace(/^@/, '')}"
							class="inline-flex items-center justify-center p-2 bg-[#ddf4ff] border-2 border-[#c7e8fa] text-[#1cb0f6] rounded-xl font-bold text-xs hover:bg-[#c7e8fa] transition cursor-pointer"
							title="Open conversation"
						>
							<MessageSquare class="w-4 h-4" />
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
