<script setup lang="ts">
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <div class="shell">
    <AppSidebar />

    <Transition name="fade">
      <div
        v-if="ui.sidebarOpen"
        class="scrim"
        role="presentation"
        @click="ui.closeSidebar()"
      />
    </Transition>

    <div class="shell-main">
      <AppTopbar />
      <main class="shell-content">
        <RouterView v-slot="{ Component, route }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100dvh;
  background: var(--bg-base);
}

.shell-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.shell-content {
  flex: 1;
  min-width: 0;
}

.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  z-index: calc(var(--z-overlay) - 1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.page-leave-to {
  opacity: 0;
}

@media (min-width: 901px) {
  .scrim {
    display: none;
  }
}
</style>
