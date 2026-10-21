<script lang="ts">
	import { api } from '$lib/api';
	import { goto } from '$app/navigation';
	import { Lock, User, AlertCircle, ArrowRight, Bot, ShieldCheck } from 'lucide-svelte';

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

<svelte:head>
	<title>Creator Sign In — ClientAgent</title>
</svelte:head>

<div class="max-w-md w-full mx-auto my-8">
	<!-- Crisp White Container with subtle border -->
	<div class="bg-white border-2 border-[#c7e8fa] rounded-xl p-8 shadow-sm">
		<!-- Brand Header -->
		<div class="flex items-center gap-3 mb-6">
			<div
				class="w-11 h-11 rounded-xl bg-[#a5ed6e] border-2 border-[#85ca54] flex items-center justify-center text-[#111111] shadow-xs shrink-0"
			>
				<Bot class="w-6 h-6 text-[#111111]" strokeWidth={2.5} />
			</div>
			<div>
				<div class="font-bold text-lg text-[#3c3c3c] tracking-tight leading-tight">
					ClientAgent
				</div>
				<span class="text-xs font-semibold text-[#1cb0f6] tracking-wide leading-tight">
					VGen Creator Studio
				</span>
			</div>
		</div>

		<!-- Page Title -->
		<div class="mb-6">
			<h1 class="text-2xl font-bold tracking-tight text-[#3c3c3c]">Creator Sign In</h1>
			<p class="text-sm font-semibold text-[#777777] mt-1">
				Authenticate to access your ClientAgent workspace.
			</p>
		</div>

		{#if error}
			<div
				role="alert"
				class="mb-6 p-4 rounded-xl bg-[#ffe5e5] border-2 border-[#ff4b4b] text-[#ff4b4b] text-sm flex items-start gap-3"
			>
				<AlertCircle class="w-5 h-5 text-[#ff4b4b] shrink-0 mt-0.5" />
				<div>
					<p class="font-bold">Authentication Error</p>
					<p class="text-xs font-semibold mt-0.5 opacity-90">{error}</p>
				</div>
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="space-y-4">
			<div>
				<label for="username" class="block text-xs font-bold text-[#3c3c3c] uppercase tracking-wider mb-1.5">
					Username
				</label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#777777]">
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
						class="block w-full pl-10 pr-3.5 py-2.5 bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl text-[#3c3c3c] placeholder-[#777777] focus:outline-none focus:border-[#1cb0f6] focus:bg-white text-sm font-medium transition-all"
					/>
				</div>
			</div>

			<div>
				<label for="password" class="block text-xs font-bold text-[#3c3c3c] uppercase tracking-wider mb-1.5">
					Password
				</label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#777777]">
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
						class="block w-full pl-10 pr-3.5 py-2.5 bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl text-[#3c3c3c] placeholder-[#777777] focus:outline-none focus:border-[#1cb0f6] focus:bg-white text-sm font-medium transition-all"
					/>
				</div>
			</div>

			<div class="pt-2">
				<button
					type="submit"
					disabled={isLoading}
					class="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#a5ed6e] hover:bg-[#95df5e] disabled:opacity-50 text-[#111111] font-bold rounded-xl text-sm transition-all border-b-4 border-[#85ca54] active:border-b-0 active:translate-y-1 cursor-pointer shadow-xs"
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

		<!-- Security badge note -->
		<div class="mt-6 pt-4 border-t-2 border-[#c7e8fa]/60 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#777777]">
			<ShieldCheck class="w-4 h-4 text-[#58cc02]" />
			<span>Protected single-user creator environment</span>
		</div>
	</div>
</div>
