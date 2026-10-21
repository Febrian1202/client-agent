<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		api,
		type ConversationSummary,
		type MessageItem
	} from '$lib/api';
	import {
		MessageSquare,
		RefreshCw,
		Send,
		ExternalLink,
		Search,
		Sparkles,
		CheckCircle2,
		AlertCircle,
		X,
		User,
		Bot,
		Clock,
		ArrowLeft
	} from 'lucide-svelte';

	// Default fallback sample conversations for robust preview
	const DEFAULT_SAMPLE_CONVERSATIONS: ConversationSummary[] = [
		{
			id: 10,
			clientId: 1,
			platform: 'vgen',
			externalId: 'VG-CONV-8941',
			externalUrl: 'https://vgen.co/KitsuneMei',
			status: 'active',
			clientUsername: 'KitsuneMei',
			clientDisplayName: 'Mei • Kitsune VTuber',
			lastMessageSnippet: 'Hi Erian! Just checking if the eye rigging sketch is ready?',
			unreadCount: 1,
			lastSyncedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString()
		},
		{
			id: 11,
			clientId: 2,
			platform: 'vgen',
			externalId: 'VG-CONV-8942',
			externalUrl: 'https://vgen.co/StarlightVT',
			status: 'active',
			clientUsername: 'StarlightVT',
			clientDisplayName: 'Starlight Ch.',
			lastMessageSnippet: "Submitted the 6 emote references! Can't wait to work with you ✨",
			unreadCount: 1,
			lastSyncedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString()
		},
		{
			id: 12,
			clientId: 3,
			platform: 'vgen',
			externalId: 'VG-CONV-8943',
			externalUrl: 'https://vgen.co/NekoRider',
			status: 'active',
			clientUsername: 'NekoRider',
			clientDisplayName: 'Neko Rider',
			lastMessageSnippet: 'Color adjustments look amazing on the jacket! Thank you!',
			unreadCount: 0,
			lastSyncedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
		},
		{
			id: 13,
			clientId: 4,
			platform: 'vgen',
			externalId: 'VG-CONV-8944',
			externalUrl: 'https://vgen.co/PixelFox',
			status: 'active',
			clientUsername: 'PixelFox',
			clientDisplayName: 'Pixel Fox',
			lastMessageSnippet: 'Can we adjust the alert duration to 4.5 seconds instead of 6?',
			unreadCount: 0,
			lastSyncedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
			createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
			updatedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString()
		}
	];

	// Default fallback sample messages
	const DEFAULT_SAMPLE_MESSAGES_MAP: Record<number, MessageItem[]> = {
		10: [
			{
				id: 5001,
				conversationId: 10,
				direction: 'inbound',
				senderType: 'client',
				senderName: 'KitsuneMei',
				clientUsername: 'KitsuneMei',
				clientDisplayName: 'Mei • Kitsune VTuber',
				content: 'Hello Erian! I placed the order for the Live2D model full rig. Let me know if you need additional references for the ear physics.',
				sentAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString()
			},
			{
				id: 5002,
				conversationId: 10,
				direction: 'outbound',
				senderType: 'creator',
				senderName: 'Erian Osamu',
				content: 'Hi Mei! Thank you so much for the commission. I have downloaded your PSD files and started structuring the head angle mesh parameters.',
				sentAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString()
			},
			{
				id: 5003,
				conversationId: 10,
				direction: 'inbound',
				senderType: 'client',
				senderName: 'KitsuneMei',
				clientUsername: 'KitsuneMei',
				clientDisplayName: 'Mei • Kitsune VTuber',
				content: 'Hi Erian! Just checking if the eye rigging sketch is ready?',
				sentAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString()
			}
		],
		11: [
			{
				id: 5101,
				conversationId: 11,
				direction: 'inbound',
				senderType: 'client',
				senderName: 'StarlightVT',
				clientUsername: 'StarlightVT',
				clientDisplayName: 'Starlight Ch.',
				content: "Submitted the 6 emote references! Can't wait to work with you ✨",
				sentAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString()
			}
		],
		12: [
			{
				id: 5201,
				conversationId: 12,
				direction: 'outbound',
				senderType: 'creator',
				senderName: 'Erian Osamu',
				content: 'Uploaded the revised jacket colorway with neon cyan trims. Let me know how it looks on your stream overlay test!',
				sentAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
			},
			{
				id: 5202,
				conversationId: 12,
				direction: 'inbound',
				senderType: 'client',
				senderName: 'NekoRider',
				clientUsername: 'NekoRider',
				clientDisplayName: 'Neko Rider',
				content: 'Color adjustments look amazing on the jacket! Thank you!',
				sentAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
			}
		],
		13: [
			{
				id: 5301,
				conversationId: 13,
				direction: 'inbound',
				senderType: 'client',
				senderName: 'PixelFox',
				clientUsername: 'PixelFox',
				clientDisplayName: 'Pixel Fox',
				content: 'Can we adjust the alert duration to 4.5 seconds instead of 6?',
				sentAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
				createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
				updatedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString()
			}
		]
	};

	// Svelte 5 Runes State
	let conversations = $state<ConversationSummary[]>([]);
	let selectedConversation = $state<ConversationSummary | null>(null);
	let messages = $state<MessageItem[]>([]);
	let searchQuery = $state('');
	let isLoadingConversations = $state(true);
	let isLoadingMessages = $state(false);
	let isSyncing = $state(false);
	let isSubmittingDraft = $state(false);
	let replyContent = $state('');
	let chatScrollContainer = $state<HTMLDivElement | null>(null);

	// Toast notification state
	let toastMessage = $state<string | null>(null);
	let toastType = $state<'success' | 'error' | 'info'>('success');
	let toastTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
		if (toastTimeout) clearTimeout(toastTimeout);
		toastMessage = message;
		toastType = type;
		toastTimeout = setTimeout(() => {
			toastMessage = null;
		}, 4000);
	}

	// Filtered conversations based on search input
	const filteredConversations = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return conversations;
		return conversations.filter((c) => {
			const usernameMatch = (c.clientUsername || '').toLowerCase().includes(query);
			const displayNameMatch = (c.clientDisplayName || '').toLowerCase().includes(query);
			const snippetMatch = (c.lastMessageSnippet || '').toLowerCase().includes(query);
			return usernameMatch || displayNameMatch || snippetMatch;
		});
	});

	// Avatar initials generator
	function getInitials(name?: string | null): string {
		if (!name) return 'CL';
		const clean = name.replace(/^@/, '').trim();
		if (clean.length <= 2) return clean.toUpperCase();
		const parts = clean.split(/[ _\-\.]+/).filter(Boolean);
		if (parts.length >= 2) {
			return (parts[0][0] + parts[1][0]).toUpperCase();
		}
		return clean.slice(0, 2).toUpperCase();
	}

	// Relative time formatting
	function formatRelativeTime(dateInput: string | Date | null | undefined): string {
		if (!dateInput) return '';
		const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
		const now = Date.now();
		const diffMs = now - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays === 1) return 'yesterday';
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	// Clock time formatting for message bubbles
	function formatMessageTime(dateInput: string | Date | null | undefined): string {
		if (!dateInput) return '';
		const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
		return date.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	// Scroll chat container to bottom
	async function scrollToBottom() {
		await tick();
		if (chatScrollContainer) {
			chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight;
		}
	}

	// Load messages for a conversation
	async function loadMessages(conversationId: number) {
		isLoadingMessages = true;
		try {
			const res = await api.getConversationMessages(conversationId);
			if (res && res.length > 0) {
				// Sort chronologically ascending
				messages = [...res].sort(
					(a, b) => new Date(a.sentAt || a.createdAt).getTime() - new Date(b.sentAt || b.createdAt).getTime()
				);
			} else {
				messages = DEFAULT_SAMPLE_MESSAGES_MAP[conversationId] || [];
			}
		} catch {
			messages = DEFAULT_SAMPLE_MESSAGES_MAP[conversationId] || [];
		} finally {
			isLoadingMessages = false;
			await scrollToBottom();
		}
	}

	// Select active conversation
	async function selectConversation(conv: ConversationSummary) {
		selectedConversation = conv;
		await loadMessages(conv.id);
	}

	// Initial load
	onMount(async () => {
		isLoadingConversations = true;
		try {
			const res = await api.listConversations();
			if (res && res.length > 0) {
				conversations = res;
			} else {
				conversations = DEFAULT_SAMPLE_CONVERSATIONS;
			}
		} catch {
			conversations = DEFAULT_SAMPLE_CONVERSATIONS;
		} finally {
			isLoadingConversations = false;
		}

		// Select the first conversation by default if available
		if (conversations.length > 0 && !selectedConversation) {
			await selectConversation(conversations[0]);
		}
	});

	// Trigger VGen Sync
	async function handleSyncConversation() {
		if (!selectedConversation) return;
		isSyncing = true;
		try {
			await api.syncConversation(selectedConversation.id);
			showToast(`Sync queued for @${selectedConversation.clientUsername}`, 'success');

			// Refresh messages after brief interval
			setTimeout(async () => {
				if (selectedConversation) {
					await loadMessages(selectedConversation.id);
				}
				isSyncing = false;
			}, 1200);
		} catch (err: any) {
			const msg = err?.message || 'Failed to trigger VGen sync';
			showToast(msg, 'error');
			isSyncing = false;
		}
	}

	// Generate or submit AI Reply Draft
	async function handleCreateDraft() {
		if (!selectedConversation) return;

		// Default draft text if empty
		const textToSend = replyContent.trim()
			? replyContent.trim()
			: `Hi ${selectedConversation.clientDisplayName || selectedConversation.clientUsername}! Thank you for checking in. The progress is going smoothly and I will share an updated preview soon.`;

		isSubmittingDraft = true;
		try {
			await api.createDraft({
				conversationId: selectedConversation.id,
				content: textToSend
			});

			replyContent = '';
			showToast('AI Reply draft created! Ready for review in Drafts & Approvals.', 'success');
		} catch (err: any) {
			const msg = err?.message || 'Failed to generate draft';
			showToast(msg, 'error');
		} finally {
			isSubmittingDraft = false;
		}
	}
</script>

<div class="max-w-7xl mx-auto space-y-4">
	<!-- Toast Notification Banner -->
	{#if toastMessage}
		<div
			class="p-3.5 rounded-xl border-2 text-xs font-bold flex items-center justify-between shadow-xs transition-all {toastType === 'success'
				? 'bg-[#e8f5e9] text-[#2e7d32] border-[#c8e6c9]'
				: toastType === 'error'
					? 'bg-[#ffebee] text-[#ff4b4b] border-[#ffcdd2]'
					: 'bg-[#ddf4ff] text-[#1cb0f6] border-[#c7e8fa]'}"
		>
			<div class="flex items-center gap-2">
				{#if toastType === 'success'}
					<CheckCircle2 class="w-4 h-4 text-[#58cc02] shrink-0" />
				{:else if toastType === 'error'}
					<AlertCircle class="w-4 h-4 text-[#ff4b4b] shrink-0" />
				{:else}
					<Sparkles class="w-4 h-4 text-[#1cb0f6] shrink-0" />
				{/if}
				<span>{toastMessage}</span>
			</div>
			<button
				type="button"
				onclick={() => (toastMessage = null)}
				aria-label="Dismiss alert"
				class="text-current hover:opacity-75 cursor-pointer ml-3 focus:outline-none"
			>
				<X class="w-4 h-4" />
			</button>
		</div>
	{/if}

	<!-- Main Chat Viewer Two-Pane Container -->
	<div class="bg-white border-2 border-[#c7e8fa] rounded-xl shadow-xs overflow-hidden flex flex-col md:flex-row h-[calc(100vh-10rem)] min-h-[580px]">
		<!-- LEFT PANE: 320px Conversation Sidebar -->
		<aside class="w-full md:w-80 md:w-[320px] shrink-0 border-b-2 md:border-b-0 md:border-r-2 border-[#c7e8fa] flex flex-col bg-[#f4faff]">
			<!-- Sidebar Header & Search -->
			<div class="p-3.5 border-b-2 border-[#c7e8fa] bg-white space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<div class="w-7 h-7 rounded-lg bg-[#ddf4ff] border border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6]">
							<MessageSquare class="w-4 h-4" />
						</div>
						<h1 class="text-sm font-bold text-[#3c3c3c]">
							Conversations
						</h1>
					</div>
					<span class="text-xs font-bold px-2 py-0.5 rounded-lg bg-[#ddf4ff] text-[#1cb0f6] border border-[#c7e8fa]">
						{conversations.length}
					</span>
				</div>

				<!-- Search Input -->
				<div class="relative">
					<Search class="w-3.5 h-3.5 text-[#777777] absolute left-3 top-1/2 -translate-y-1/2" />
					<input
						type="search"
						bind:value={searchQuery}
						placeholder="Search conversations..."
						aria-label="Search conversations"
						class="w-full pl-8.5 pr-3 py-1.5 bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl text-xs font-medium text-[#3c3c3c] placeholder-[#777777] focus:outline-none focus:ring-2 focus:ring-[#1cb0f6] focus:bg-white transition-all"
					/>
				</div>
			</div>

			<!-- Conversation List Items (Scrollable) -->
			<div class="flex-1 overflow-y-auto divide-y divide-[#c7e8fa]/60">
				{#if filteredConversations.length === 0}
					<div class="p-8 text-center space-y-2">
						<div class="w-10 h-10 rounded-xl bg-white border-2 border-[#c7e8fa] flex items-center justify-center text-[#777777] mx-auto">
							<MessageSquare class="w-5 h-5 text-[#777777]" />
						</div>
						<p class="text-xs font-bold text-[#3c3c3c]">No conversations found</p>
						<p class="text-[11px] text-[#777777]">Try adjusting your search query.</p>
					</div>
				{:else}
					{#each filteredConversations as conv (conv.id)}
						{@const isSelected = selectedConversation?.id === conv.id}
						{@const initials = getInitials(conv.clientUsername)}
						<button
							type="button"
							onclick={() => selectConversation(conv)}
							class="w-full text-left p-3.5 transition-colors cursor-pointer flex items-start gap-3 focus:outline-none focus:ring-2 focus:ring-[#1cb0f6] {isSelected
								? 'bg-[#ddf4ff] border-l-4 border-l-[#1cb0f6] border-b border-b-[#c7e8fa]'
								: 'hover:bg-white'}"
						>
							<!-- Client Avatar Initial -->
							<div class="w-10 h-10 rounded-xl bg-white border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6] font-bold text-xs shrink-0 shadow-2xs">
								{initials}
							</div>

							<!-- Conversation Meta -->
							<div class="min-w-0 flex-1">
								<div class="flex items-center justify-between gap-1 mb-0.5">
									<span class="text-xs font-bold text-[#3c3c3c] truncate">
										@{conv.clientUsername}
									</span>
									<span class="text-[10px] font-semibold text-[#777777] shrink-0">
										{formatRelativeTime(conv.lastSyncedAt || conv.updatedAt)}
									</span>
								</div>

								{#if conv.clientDisplayName && conv.clientDisplayName !== conv.clientUsername}
									<div class="text-[11px] font-medium text-[#777777] truncate mb-1">
										{conv.clientDisplayName}
									</div>
								{/if}

								<!-- Snippet -->
								<p class="text-xs text-[#777777] truncate leading-tight font-normal">
									{conv.lastMessageSnippet || 'No messages yet'}
								</p>
							</div>

							<!-- Unread Dot Indicator -->
							{#if conv.unreadCount && conv.unreadCount > 0}
								<span class="w-2 h-2 rounded-full bg-[#1cb0f6] shrink-0 mt-1.5" title="Unread messages"></span>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</aside>

		<!-- RIGHT PANE: flex-1 Active Conversation Thread & Action Bar -->
		<section class="flex-1 flex flex-col min-w-0 bg-white" aria-label="Conversation message thread">
			{#if selectedConversation}
				{@const activeInitials = getInitials(selectedConversation.clientUsername)}
				<!-- Right Pane Header Bar -->
				<header class="p-3.5 border-b-2 border-[#c7e8fa] bg-white flex items-center justify-between gap-3 shrink-0">
					<div class="flex items-center gap-3 min-w-0">
						<!-- Avatar Initial -->
						<div class="w-10 h-10 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6] font-bold text-sm shrink-0 shadow-2xs">
							{activeInitials}
						</div>

						<!-- Client Identity Details -->
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<h2 class="text-sm font-bold text-[#3c3c3c] truncate">
									@{selectedConversation.clientUsername}
								</h2>
								{#if selectedConversation.clientDisplayName}
									<span class="text-xs font-semibold text-[#777777] truncate hidden sm:inline">
										({selectedConversation.clientDisplayName})
									</span>
								{/if}
							</div>

							<!-- External VGen Profile Link -->
							<div class="flex items-center gap-2 mt-0.5">
								<a
									href={selectedConversation.externalUrl || `https://vgen.co/${selectedConversation.clientUsername}`}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1 text-[11px] font-bold text-[#1cb0f6] hover:underline"
								>
									<span>vgen.co/{selectedConversation.clientUsername}</span>
									<ExternalLink class="w-3 h-3 text-[#1cb0f6]" />
								</a>
								<span class="text-[10px] text-[#777777]">•</span>
								<span class="text-[10px] text-[#777777] flex items-center gap-1">
									<Clock class="w-3 h-3 text-[#777777]" />
									Synced {formatRelativeTime(selectedConversation.lastSyncedAt)}
								</span>
							</div>
						</div>
					</div>

					<!-- Header Actions: Sync from VGen Button -->
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={handleSyncConversation}
							disabled={isSyncing}
							aria-label="Sync from VGen"
							class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border-2 border-[#c7e8fa] hover:bg-[#f4faff] hover:border-[#1cb0f6] text-[#3c3c3c] font-bold text-xs transition-all shadow-xs cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#1cb0f6]"
						>
							<RefreshCw class="w-3.5 h-3.5 {isSyncing ? 'animate-spin text-[#1cb0f6]' : 'text-[#777777]'}" />
							<span class="hidden sm:inline">Sync from VGen</span>
						</button>
					</div>
				</header>

				<!-- Message Thread Scroll Container -->
				<div
					bind:this={chatScrollContainer}
					class="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 bg-white"
				>
					{#if isLoadingMessages}
						<div class="flex items-center justify-center h-48 text-xs font-semibold text-[#777777] gap-2">
							<RefreshCw class="w-4 h-4 animate-spin text-[#1cb0f6]" />
							<span>Loading messages...</span>
						</div>
					{:else if messages.length === 0}
						<div class="flex flex-col items-center justify-center h-48 text-center space-y-2">
							<div class="w-10 h-10 rounded-xl bg-[#f4faff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#777777]">
								<MessageSquare class="w-5 h-5 text-[#777777]" />
							</div>
							<p class="text-xs font-bold text-[#3c3c3c]">No messages recorded yet</p>
							<p class="text-[11px] text-[#777777]">Use "Sync from VGen" above to fetch latest client messages.</p>
						</div>
					{:else}
						{#each messages as msg (msg.id)}
							{#if msg.direction === 'inbound'}
								<!-- Inbound Message Bubble (Client) -->
								<div class="flex items-start gap-2.5 max-w-xl">
									<!-- Client Avatar Initial -->
									<div class="w-8 h-8 rounded-xl bg-[#ddf4ff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#1cb0f6] font-bold text-xs shrink-0 mt-0.5">
										{getInitials(msg.senderName || selectedConversation.clientUsername)}
									</div>

									<div class="space-y-1 min-w-0">
										<!-- Sender Name & Timestamp -->
										<div class="flex items-center gap-2 pl-1">
											<span class="text-xs font-bold text-[#3c3c3c]">
												{msg.senderName || selectedConversation.clientDisplayName || selectedConversation.clientUsername}
											</span>
											<span class="text-[10px] font-semibold text-[#777777]">
												{formatMessageTime(msg.sentAt || msg.createdAt)}
											</span>
										</div>

										<!-- Bubble Surface: #f4faff subtle surface with #c7e8fa border -->
										<div class="bg-[#f4faff] border-2 border-[#c7e8fa] rounded-xl rounded-tl-sm p-3.5 text-xs text-[#3c3c3c] leading-relaxed shadow-xs whitespace-pre-wrap break-words">
											{msg.content}
										</div>
									</div>
								</div>
							{:else if msg.direction === 'outbound'}
								<!-- Outbound Message Bubble (Creator / Erian Osamu) -->
								<div class="flex items-start justify-end gap-2.5 max-w-xl ml-auto">
									<div class="space-y-1 min-w-0 text-right">
										<!-- Sender Name & Timestamp -->
										<div class="flex items-center justify-end gap-2 pr-1">
											<span class="text-[10px] font-semibold text-[#777777]">
												{formatMessageTime(msg.sentAt || msg.createdAt)}
											</span>
											<span class="text-xs font-bold text-[#1cb0f6]">
												{msg.senderName || 'You (Erian Osamu)'}
											</span>
										</div>

										<!-- Creator Accent Bubble Surface: #ddf4ff with #1cb0f6 border styling -->
										<div class="bg-[#ddf4ff] border-2 border-[#c7e8fa] rounded-xl rounded-tr-sm p-3.5 text-xs text-[#3c3c3c] leading-relaxed shadow-xs text-left whitespace-pre-wrap break-words">
											{msg.content}
										</div>
									</div>

									<!-- Creator Avatar Initial -->
									<div class="w-8 h-8 rounded-xl bg-[#a5ed6e] border-2 border-[#85ca54] flex items-center justify-center text-[#111111] font-bold text-xs shrink-0 mt-0.5">
										EO
									</div>
								</div>
							{/if}
						{/each}
					{/if}
				</div>

				<!-- BOTTOM ACTION BAR: AI Reply Trigger & Draft Creation -->
				<footer class="p-3.5 border-t-2 border-[#c7e8fa] bg-[#f4faff] space-y-2 shrink-0">
					<div class="flex items-center justify-between text-xs">
						<div class="flex items-center gap-1.5 font-bold text-[#3c3c3c]">
							<Sparkles class="w-4 h-4 text-[#1cb0f6]" />
							<span>Draft Assistant</span>
						</div>
						<span class="text-[11px] text-[#777777] font-semibold">
							Creates draft requiring human approval
						</span>
					</div>

					<div class="flex items-center gap-2">
						<input
							type="text"
							bind:value={replyContent}
							placeholder="Type draft message or instructions for AI reply..."
							aria-label="Draft response content"
							onkeydown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									handleCreateDraft();
								}
							}}
							class="flex-1 px-3.5 py-2.5 bg-white border-2 border-[#c7e8fa] rounded-xl text-xs font-medium text-[#3c3c3c] placeholder-[#777777] focus:outline-none focus:ring-2 focus:ring-[#1cb0f6] transition-all"
						/>

						<!-- Generate AI Reply Primary CTA Button (#a5ed6e) -->
						<button
							type="button"
							onclick={handleCreateDraft}
							disabled={isSubmittingDraft}
							aria-label="Generate AI Reply"
							class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#a5ed6e] hover:bg-[#94e65b] text-[#111111] font-bold text-xs transition-all border-2 border-[#85ca54] shadow-xs cursor-pointer disabled:opacity-60 shrink-0 focus:outline-none focus:ring-2 focus:ring-[#85ca54]"
						>
							{#if isSubmittingDraft}
								<RefreshCw class="w-3.5 h-3.5 animate-spin text-[#111111]" />
								<span>Creating...</span>
							{:else}
								<Sparkles class="w-3.5 h-3.5 text-[#111111]" />
								<span>Generate AI Reply</span>
							{/if}
						</button>
					</div>
				</footer>
			{:else}
				<!-- Empty State when no conversation is selected -->
				<div class="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
					<div class="w-14 h-14 rounded-xl bg-[#f4faff] border-2 border-[#c7e8fa] flex items-center justify-center text-[#777777]">
						<MessageSquare class="w-7 h-7 text-[#1cb0f6]" />
					</div>
					<h3 class="text-sm font-bold text-[#3c3c3c]">
						Select a conversation
					</h3>
					<p class="text-xs text-[#777777] max-w-sm">
						Choose a conversation from the sidebar to inspect client messages, sync with VGen, and generate contextual response drafts.
					</p>
				</div>
			{/if}
		</section>
	</div>
</div>
