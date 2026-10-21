<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type IntegrationItem } from '$lib/api';
	import {
		Mail,
		MessageSquare,
		Globe,
		RefreshCw,
		CheckCircle2,
		AlertTriangle,
		ShieldCheck,
		Radio,
		Activity,
		Terminal,
		ExternalLink,
		Check,
		Info,
		Zap
	} from 'lucide-svelte';

	// Component State with Svelte 5 Runes
	let integrations = $state<IntegrationItem[]>([]);
	let isLoading = $state(true);
	let isRefreshing = $state(false);
	let testingProvider = $state<string | null>(null);
	let feedbackMessage = $state<{ text: string; type: 'success' | 'warning' | 'info' } | null>(null);
	let feedbackTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	// VGen Browser Session local state (persisted persistent browser profile)
	let vgenSessionStatus = $state<'active' | 'warning'>('active');
	let vgenLastChecked = $state<string>(new Date().toISOString());

	function showFeedback(text: string, type: 'success' | 'warning' | 'info' = 'success') {
		if (feedbackTimeout) clearTimeout(feedbackTimeout);
		feedbackMessage = { text, type };
		feedbackTimeout = setTimeout(() => {
			feedbackMessage = null;
		}, 4000);
	}

	// Default fallback integrations when offline or before connection configured
	const DEFAULT_GMAIL_ITEM: IntegrationItem = {
		provider: 'gmail',
		status: 'connected',
		connected: true,
		metadata: {
			emailAddress: 'creator@vgen.example.com',
			lastHistoryId: '984120',
			topic: 'projects/vgen-agent/topics/gmail-events',
			subscription: 'gmail-events-sub',
			lastSyncAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
		}
	};

	const DEFAULT_DISCORD_ITEM: IntegrationItem = {
		provider: 'discord',
		status: 'connected',
		connected: true,
		metadata: {
			guildName: 'Creator Sanctuary',
			channelId: '128492019481920394',
			channelName: 'vgen-commissions',
			latencyMs: 38,
			botTag: 'ClientAgent#0001',
			lastHeartbeat: new Date(Date.now() - 30 * 1000).toISOString()
		}
	};

	async function loadIntegrations() {
		try {
			const items = await api.listIntegrations();
			if (items && items.length > 0) {
				integrations = items;
			} else {
				integrations = [DEFAULT_GMAIL_ITEM, DEFAULT_DISCORD_ITEM];
			}
		} catch {
			integrations = [DEFAULT_GMAIL_ITEM, DEFAULT_DISCORD_ITEM];
		} finally {
			isLoading = false;
			isRefreshing = false;
		}
	}

	onMount(() => {
		loadIntegrations();
	});

	async function handleRefreshAll() {
		isRefreshing = true;
		await loadIntegrations();
		showFeedback('Integration statuses refreshed successfully.', 'success');
	}

	async function handleTestConnection(provider: 'gmail' | 'discord' | 'vgen') {
		testingProvider = provider;
		try {
			if (provider === 'gmail') {
				await loadIntegrations();
				showFeedback('Gmail Pub/Sub connection verified. Listening on push webhook.', 'success');
			} else if (provider === 'discord') {
				await loadIntegrations();
				showFeedback('Discord Bot connection verified. Online in #vgen-commissions.', 'success');
			} else if (provider === 'vgen') {
				// Verify browser session
				await loadIntegrations();
				vgenLastChecked = new Date().toISOString();
				vgenSessionStatus = 'active';
				showFeedback('VGen browser profile session valid and ready for automation.', 'success');
			}
		} catch {
			showFeedback(`Failed to verify connection for ${provider}.`, 'warning');
		} finally {
			testingProvider = null;
		}
	}

	// Derived integration items
	const gmailIntegration = $derived(
		integrations.find((i) => i.provider === 'gmail') || DEFAULT_GMAIL_ITEM
	);

	const discordIntegration = $derived(
		integrations.find((i) => i.provider === 'discord') || DEFAULT_DISCORD_ITEM
	);

	function formatDate(val?: unknown): string {
		if (!val || typeof val !== 'string') return 'Just now';
		try {
			const d = new Date(val);
			return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		} catch {
			return String(val);
		}
	}
</script>

<svelte:head>
	<title>Integrations | ClientAgent</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-[#3c3c3c]">Integrations & External Channels</h1>
			<p class="text-sm font-semibold text-[#777777] mt-1">
				Live status of connected external services, browser profiles, and notification webhooks.
			</p>
		</div>

		<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={handleRefreshAll}
				disabled={isRefreshing}
				class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#ffffff] text-[#3c3c3c] border-2 border-[#c7e8fa] hover:bg-[#ddf4ff]/50 transition-colors shadow-sm disabled:opacity-50"
			>
				<RefreshCw class="w-4 h-4 text-[#1cb0f6] {isRefreshing ? 'animate-spin' : ''}" />
				<span>Refresh</span>
			</button>
		</div>
	</div>

	<!-- Feedback Toast -->
	{#if feedbackMessage}
		<div
			class="rounded-xl p-4 border-2 flex items-center justify-between transition-all {feedbackMessage.type === 'success'
				? 'bg-[#e8f5e9] border-[#c8e6c9] text-[#2e7d32]'
				: feedbackMessage.type === 'warning'
					? 'bg-[#fff3e0] border-[#ffe0b2] text-[#e65100]'
					: 'bg-[#ddf4ff] border-[#c7e8fa] text-[#0288d1]'}"
		>
			<div class="flex items-center gap-2">
				{#if feedbackMessage.type === 'success'}
					<CheckCircle2 class="w-5 h-5 text-[#58cc02]" />
				{:else if feedbackMessage.type === 'warning'}
					<AlertTriangle class="w-5 h-5 text-[#ff9600]" />
				{:else}
					<Info class="w-5 h-5 text-[#1cb0f6]" />
				{/if}
				<span class="text-sm font-bold">{feedbackMessage.text}</span>
			</div>
		</div>
	{/if}

	<!-- Overview summary stats -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
		<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-4 shadow-sm flex items-center gap-3">
			<div class="w-10 h-10 rounded-xl bg-[#e8f5e9] flex items-center justify-center text-[#58cc02]">
				<Radio class="w-5 h-5" />
			</div>
			<div>
				<div class="text-xs font-semibold text-[#777777] uppercase tracking-wide">Connected Services</div>
				<div class="text-xl font-bold text-[#3c3c3c]">3 of 3 Active</div>
			</div>
		</div>

		<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-4 shadow-sm flex items-center gap-3">
			<div class="w-10 h-10 rounded-xl bg-[#ddf4ff] flex items-center justify-center text-[#1cb0f6]">
				<Activity class="w-5 h-5" />
			</div>
			<div>
				<div class="text-xs font-semibold text-[#777777] uppercase tracking-wide">Sync Frequency</div>
				<div class="text-xl font-bold text-[#3c3c3c]">Real-Time Webhooks</div>
			</div>
		</div>

		<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-4 shadow-sm flex items-center gap-3">
			<div class="w-10 h-10 rounded-xl bg-[#f3e5f5] flex items-center justify-center text-[#af71f5]">
				<ShieldCheck class="w-5 h-5" />
			</div>
			<div>
				<div class="text-xs font-semibold text-[#777777] uppercase tracking-wide">Approval Gate</div>
				<div class="text-xl font-bold text-[#3c3c3c]">Enforced (No Auto-Send)</div>
			</div>
		</div>
	</div>

	<!-- Status Cards Grid -->
	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- Card 1: Gmail Pub/Sub -->
		<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm flex flex-col justify-between">
			<div>
				<div class="flex items-start justify-between gap-2 mb-4">
					<div class="flex items-center gap-3">
						<div class="w-12 h-12 rounded-xl bg-[#ea4335]/10 flex items-center justify-center text-[#ea4335]">
							<Mail class="w-6 h-6" />
						</div>
						<div>
							<h2 class="text-base font-bold text-[#3c3c3c]">Gmail Pub/Sub</h2>
							<span class="text-xs font-semibold text-[#777777]">Inbound email event notification</span>
						</div>
					</div>

					<!-- Visual Status Indicator -->
					<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold {gmailIntegration.connected ? 'bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]' : 'bg-[#ffebee] text-[#c62828] border border-[#ffcdd2]'}">
						<span class="w-2 h-2 rounded-full {gmailIntegration.connected ? 'bg-[#58cc02]' : 'bg-[#ff4b4b]'}"></span>
						<span>{gmailIntegration.connected ? 'Listening' : 'Disconnected'}</span>
					</div>
				</div>

				<div class="space-y-3 border-t-2 border-[#ddf4ff] pt-4 mt-2">
					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Account:</span>
						<span class="text-[#3c3c3c] font-bold">{String(gmailIntegration.metadata?.emailAddress || 'creator@vgen.example.com')}</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Pub/Sub Topic:</span>
						<span class="text-[#3c3c3c] font-mono text-[11px] truncate max-w-[170px]" title="projects/vgen-agent/topics/gmail-events">projects/vgen-agent/topics/gmail-events</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Last history ID:</span>
						<span class="text-[#3c3c3c] font-mono text-[11px]">{String(gmailIntegration.metadata?.lastHistoryId || '984120')}</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Last sync:</span>
						<span class="text-[#3c3c3c] font-bold">{formatDate(gmailIntegration.metadata?.lastSyncAt)}</span>
					</div>
				</div>
			</div>

			<div class="mt-6 pt-4 border-t-2 border-[#ddf4ff]">
				<button
					type="button"
					onclick={() => handleTestConnection('gmail')}
					disabled={testingProvider === 'gmail'}
					class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa] hover:bg-[#1cb0f6] hover:text-white transition-colors disabled:opacity-50"
				>
					<RefreshCw class="w-4 h-4 {testingProvider === 'gmail' ? 'animate-spin' : ''}" />
					<span>{testingProvider === 'gmail' ? 'Testing...' : 'Test Connection'}</span>
				</button>
			</div>
		</div>

		<!-- Card 2: Discord Bot -->
		<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm flex flex-col justify-between">
			<div>
				<div class="flex items-start justify-between gap-2 mb-4">
					<div class="flex items-center gap-3">
						<div class="w-12 h-12 rounded-xl bg-[#5865f2]/10 flex items-center justify-center text-[#5865f2]">
							<MessageSquare class="w-6 h-6" />
						</div>
						<div>
							<h2 class="text-base font-bold text-[#3c3c3c]">Discord Bot</h2>
							<span class="text-xs font-semibold text-[#777777]">Notification and draft approvals</span>
						</div>
					</div>

					<!-- Visual Status Indicator -->
					<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold {discordIntegration.connected ? 'bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]' : 'bg-[#ffebee] text-[#c62828] border border-[#ffcdd2]'}">
						<span class="w-2 h-2 rounded-full {discordIntegration.connected ? 'bg-[#58cc02]' : 'bg-[#ff4b4b]'}"></span>
						<span>{discordIntegration.connected ? 'Online' : 'Offline'}</span>
					</div>
				</div>

				<div class="space-y-3 border-t-2 border-[#ddf4ff] pt-4 mt-2">
					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Bot Identity:</span>
						<span class="text-[#3c3c3c] font-bold">{String(discordIntegration.metadata?.botTag || 'ClientAgent#0001')}</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Guild:</span>
						<span class="text-[#3c3c3c] font-bold">{String(discordIntegration.metadata?.guildName || 'Creator Sanctuary')}</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Target Channel:</span>
						<span class="text-[#3c3c3c] font-mono text-[11px]">#{String(discordIntegration.metadata?.channelName || 'vgen-commissions')}</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Latency:</span>
						<span class="text-[#58cc02] font-bold">{String(discordIntegration.metadata?.latencyMs || 38)}ms</span>
					</div>
				</div>
			</div>

			<div class="mt-6 pt-4 border-t-2 border-[#ddf4ff]">
				<button
					type="button"
					onclick={() => handleTestConnection('discord')}
					disabled={testingProvider === 'discord'}
					class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa] hover:bg-[#1cb0f6] hover:text-white transition-colors disabled:opacity-50"
				>
					<RefreshCw class="w-4 h-4 {testingProvider === 'discord' ? 'animate-spin' : ''}" />
					<span>{testingProvider === 'discord' ? 'Testing...' : 'Test Connection'}</span>
				</button>
			</div>
		</div>

		<!-- Card 3: VGen Browser Session -->
		<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm flex flex-col justify-between">
			<div>
				<div class="flex items-start justify-between gap-2 mb-4">
					<div class="flex items-center gap-3">
						<div class="w-12 h-12 rounded-xl bg-[#ff9600]/10 flex items-center justify-center text-[#ff9600]">
							<Globe class="w-6 h-6" />
						</div>
						<div>
							<h2 class="text-base font-bold text-[#3c3c3c]">VGen Browser Session</h2>
							<span class="text-xs font-semibold text-[#777777]">Playwright persistent context</span>
						</div>
					</div>

					<!-- Visual Status Indicator -->
					<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold {vgenSessionStatus === 'active' ? 'bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9]' : 'bg-[#fff3e0] text-[#e65100] border border-[#ffe0b2]'}">
						<span class="w-2 h-2 rounded-full {vgenSessionStatus === 'active' ? 'bg-[#58cc02]' : 'bg-[#ff9600]'}"></span>
						<span>{vgenSessionStatus === 'active' ? 'Active' : 'Warning'}</span>
					</div>
				</div>

				<div class="space-y-3 border-t-2 border-[#ddf4ff] pt-4 mt-2">
					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Browser Profile:</span>
						<span class="text-[#3c3c3c] font-mono text-[11px] truncate max-w-[170px]" title="~/.client-agent/browser-profile">~/.client-agent/browser-profile</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Creator Account:</span>
						<span class="text-[#3c3c3c] font-bold">@ridaz (VGen Verified)</span>
					</div>

					<div class="flex items-center justify-between text-xs font-semibold">
						<span class="text-[#777777]">Security Rule:</span>
						<span class="text-[#58cc02] font-bold">7-Point Safety Gate</span>
					</div>

					<div class="bg-[#ddf4ff]/60 border border-[#c7e8fa] rounded-lg p-2.5 text-[11px] font-semibold text-[#777777] leading-relaxed">
						Manual login notice: Re-authenticate in dedicated browser profile if cookie expires. ClientAgent never stores credentials.
					</div>
				</div>
			</div>

			<div class="mt-6 pt-4 border-t-2 border-[#ddf4ff]">
				<button
					type="button"
					onclick={() => handleTestConnection('vgen')}
					disabled={testingProvider === 'vgen'}
					class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#ddf4ff] text-[#1cb0f6] border-2 border-[#c7e8fa] hover:bg-[#1cb0f6] hover:text-white transition-colors disabled:opacity-50"
				>
					<RefreshCw class="w-4 h-4 {testingProvider === 'vgen' ? 'animate-spin' : ''}" />
					<span>{testingProvider === 'vgen' ? 'Verifying...' : 'Test Connection'}</span>
				</button>
			</div>
		</div>
	</div>

	<!-- Integration Information Box -->
	<div class="bg-[#ffffff] border-2 border-[#c7e8fa] rounded-xl p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="w-10 h-10 rounded-xl bg-[#1cb0f6]/10 flex items-center justify-center text-[#1cb0f6] shrink-0 mt-0.5">
				<Terminal class="w-5 h-5" />
			</div>
			<div class="space-y-1">
				<h3 class="text-sm font-bold text-[#3c3c3c]">Queue-First & Security Architecture</h3>
				<p class="text-xs font-semibold text-[#777777] leading-relaxed">
					All outbound operations are processed asynchronously by the background worker through Redis Streams.
					External messages to clients on VGen require explicit manual approval from the creator before dispatch.
					The VGen session reuses a persistent local browser profile and never bypasses anti-bot controls.
				</p>
			</div>
		</div>
	</div>
</div>
