<script lang="ts">
	import './layout.css';
	import type { LayoutProps } from './$types';
	import { ShieldCheck } from 'lucide-svelte';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>ClientAgent — VGen AI Assistant</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
	<!-- Top Navigation Bar -->
	<header class="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-50">
		<div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
			<div class="flex items-center space-x-3">
				<div class="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200">
					<ShieldCheck class="w-5 h-5 text-emerald-400" />
				</div>
				<div>
					<a href="/dashboard" class="font-semibold tracking-tight text-white hover:text-zinc-200 transition-colors">
						ClientAgent
					</a>
					<span class="hidden sm:inline-block ml-2 text-xs text-zinc-400 font-mono">v0.1.0 (Phase 0)</span>
				</div>
			</div>

			<nav class="flex items-center space-x-1 sm:space-x-4">
				<a
					href="/dashboard"
					class="px-3 py-1.5 text-sm font-medium rounded-md text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
				>
					Dashboard
				</a>
				<a
					href="/login"
					class="px-3 py-1.5 text-sm font-medium rounded-md text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
				>
					Login
				</a>
			</nav>
		</div>
	</header>

	<!-- Main Body Content -->
	<main class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
		{@render children()}
	</main>

	<!-- Footer -->
	<footer class="border-t border-zinc-800 py-6 text-center text-xs text-zinc-400">
		<div class="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
			<p>ClientAgent — Personal AI Assistant for VGen Creators</p>
			<p class="font-mono text-zinc-400">Phase 0: Foundation</p>
		</div>
	</footer>
</div>
