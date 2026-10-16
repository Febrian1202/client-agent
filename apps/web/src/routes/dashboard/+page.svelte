<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, type HealthStatus, type UserProfile } from '#lib/api';
	import { Server, Database, LogOut, CheckCircle2, AlertTriangle, Layers, Activity } from 'lucide-svelte';

	let user = $state<UserProfile | null>(null);
	let health = $state<HealthStatus | null>(null);
	let isLoading = $state(true);
	let isLoggingOut = $state(false);

	onMount(async () => {
		try {
			const currentUser = await api.getMe();
			if (!currentUser) {
				await goto('/login');
				return;
			}
			user = currentUser;

			// Fetch system health
			try {
				health = await api.getHealth();
			} catch {
				health = { status: 'unready', database: 'error', redis: 'error' };
			}
		} finally {
			isLoading = false;
		}
	});

	async function handleLogout() {
		isLoggingOut = true;
		try {
			await api.logout();
			await goto('/login');
		} finally {
			isLoggingOut = false;
		}
	}
</script>

{#if isLoading}
	<div class="py-24 text-center">
		<div class="inline-block animate-spin rounded-full h-8 w-8 border-2 border-zinc-600 border-t-emerald-500 mb-4"></div>
		<p class="text-sm text-zinc-400">Verifying session...</p>
	</div>
{:else if user}
	<div class="space-y-8">
		<!-- Header / User Info -->
		<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-zinc-800">
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-white">ClientAgent Dashboard</h1>
				<p class="text-sm text-zinc-400 mt-1">Phase 0 Shell — Foundation & Infrastructure Active</p>
			</div>

			<div class="flex items-center gap-4">
				<div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm">
					<div class="w-2 h-2 rounded-full bg-emerald-500"></div>
					<span class="text-zinc-200 font-medium">{user.name}</span>
					<span class="text-zinc-500 font-mono text-xs">({user.email})</span>
				</div>

				<button
					onclick={handleLogout}
					disabled={isLoggingOut}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-sm font-medium transition-colors cursor-pointer"
				>
					<LogOut class="w-4 h-4" />
					<span>Logout</span>
				</button>
			</div>
		</div>

		<!-- Status Grid -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<!-- System Health Card -->
			<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
				<div class="flex items-center justify-between mb-3">
					<span class="text-xs font-semibold uppercase tracking-wider text-zinc-400">System Readiness</span>
					<Activity class="w-4 h-4 text-emerald-400" />
				</div>
				<div class="flex items-center gap-2">
					{#if health?.status === 'ready'}
						<CheckCircle2 class="w-5 h-5 text-emerald-400" />
						<span class="text-lg font-semibold text-white">Ready</span>
					{:else}
						<AlertTriangle class="w-5 h-5 text-amber-400" />
						<span class="text-lg font-semibold text-white">Degraded / Unready</span>
					{/if}
				</div>
				<p class="text-xs text-zinc-500 mt-2">API health endpoint verified</p>
			</div>

			<!-- PostgreSQL Status Card -->
			<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
				<div class="flex items-center justify-between mb-3">
					<span class="text-xs font-semibold uppercase tracking-wider text-zinc-400">PostgreSQL (Drizzle)</span>
					<Database class="w-4 h-4 text-blue-400" />
				</div>
				<div class="flex items-center gap-2">
					{#if health?.database === 'ok'}
						<div class="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
						<span class="text-lg font-semibold text-white">Connected</span>
					{:else}
						<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div>
						<span class="text-lg font-semibold text-white">Disconnected</span>
					{/if}
				</div>
				<p class="text-xs text-zinc-500 mt-2">Port 5433 / Drizzle migrations applied</p>
			</div>

			<!-- Redis Streams Card -->
			<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
				<div class="flex items-center justify-between mb-3">
					<span class="text-xs font-semibold uppercase tracking-wider text-zinc-400">Redis & Streams</span>
					<Server class="w-4 h-4 text-red-400" />
				</div>
				<div class="flex items-center gap-2">
					{#if health?.redis === 'ok'}
						<div class="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
						<span class="text-lg font-semibold text-white">Active</span>
					{:else}
						<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div>
						<span class="text-lg font-semibold text-white">Disconnected</span>
					{/if}
				</div>
				<p class="text-xs text-zinc-500 mt-2">Port 6380 / Stream Consumer active</p>
			</div>
		</div>

		<!-- Phase 0 Scope Overview -->
		<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
			<div class="flex items-center gap-2.5 mb-4">
				<Layers class="w-5 h-5 text-emerald-400" />
				<h2 class="text-base font-semibold text-white">Foundation Architecture Status</h2>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
				<div class="p-4 rounded-lg bg-zinc-950 border border-zinc-800/80">
					<p class="font-medium text-zinc-200">Backend API (Elysia)</p>
					<p class="text-zinc-400 text-xs mt-1">
						Running HTTP server on port 3001 with single-user Argon2 authentication and Redis session storage.
					</p>
				</div>

				<div class="p-4 rounded-lg bg-zinc-950 border border-zinc-800/80">
					<p class="font-medium text-zinc-200">Background Worker</p>
					<p class="text-zinc-400 text-xs mt-1">
						Standalone Bun worker listening on Redis Streams with consumer group acknowledgment and 30s heartbeat.
					</p>
				</div>

				<div class="p-4 rounded-lg bg-zinc-950 border border-zinc-800/80">
					<p class="font-medium text-zinc-200">Domain Models & Contracts</p>
					<p class="text-zinc-400 text-xs mt-1">
						Strict TypeScript interfaces, task state machines, audit log actions, and API envelopes in <code class="text-zinc-300">@client-agent/domain</code>.
					</p>
				</div>

				<div class="p-4 rounded-lg bg-zinc-950 border border-zinc-800/80">
					<p class="font-medium text-zinc-200">Docker Infrastructure</p>
					<p class="text-zinc-400 text-xs mt-1">
						Dev compose for local Postgres & Redis; Production compose for Dokploy VPS deployment.
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}
