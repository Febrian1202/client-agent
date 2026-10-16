<script lang="ts">
	import { api } from '#lib/api';
	import { goto } from '$app/navigation';
	import { Lock, User, AlertCircle, ArrowRight } from 'lucide-svelte';

	let username = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let isLoading = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		isLoading = true;

		try {
			await api.login(username, password);
			await goto('/dashboard');
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : 'Authentication failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="max-w-md mx-auto my-12">
	<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6 sm:p-8 shadow-sm">
		<div class="mb-6">
			<h1 class="text-2xl font-bold tracking-tight text-white">Creator Sign In</h1>
			<p class="text-sm text-zinc-400 mt-1">Authenticate to access your ClientAgent workspace.</p>
		</div>

		{#if error}
			<div
				role="alert"
				class="mb-6 p-4 rounded-lg bg-red-950/50 border border-red-800 text-red-200 text-sm flex items-start gap-3"
			>
				<AlertCircle class="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
				<div>
					<p class="font-medium">Authentication Error</p>
					<p class="text-red-300 mt-0.5">{error}</p>
				</div>
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="space-y-4">
			<div>
				<label for="username" class="block text-sm font-medium text-zinc-300 mb-1.5">
					Username
				</label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
						<User class="w-4 h-4" />
					</div>
					<input
						id="username"
						name="username"
						type="text"
						required
						autocomplete="username"
						placeholder="admin"
						bind:value={username}
						class="block w-full pl-10 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
					/>
				</div>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-zinc-300 mb-1.5">
					Password
				</label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
						<Lock class="w-4 h-4" />
					</div>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="current-password"
						placeholder="••••••••"
						bind:value={password}
						class="block w-full pl-10 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm transition-all"
					/>
				</div>
			</div>

			<div class="pt-2">
				<button
					type="submit"
					disabled={isLoading}
					class="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer"
				>
					{#if isLoading}
						<span>Signing in...</span>
					{:else}
						<span>Sign In</span>
						<ArrowRight class="w-4 h-4" />
					{/if}
				</button>
			</div>
		</form>
	</div>
</div>
