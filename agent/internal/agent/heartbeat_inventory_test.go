package agent

import (
	"fmt"
	"testing"
)

func TestHeartbeatInventoryFiltersUnmanagedProjectsAndRejectsOverflow(t *testing.T) {
	ids := []string{"other-compose-project"}
	states := []composeRuntime{{RuntimeID: "other-compose-project", Services: make([]composeService, 501)}}
	for index := 0; index < 200; index++ {
		id := fmt.Sprintf("dp_project_%d", index)
		ids = append(ids, id)
		states = append(states, composeRuntime{RuntimeID: id, Services: []composeService{{Name: "web"}}})
	}
	managedIDs, err := heartbeatRuntimeIDs(ids)
	if err != nil || len(managedIDs) != 200 {
		t.Fatalf("expected complete managed IDs: count=%d error=%v", len(managedIDs), err)
	}
	managedStates, err := heartbeatRuntimeStates(states)
	if err != nil || len(managedStates) != 200 {
		t.Fatalf("expected complete managed states: count=%d error=%v", len(managedStates), err)
	}
	ids = append(ids, "dp_overflow")
	states = append(states, composeRuntime{RuntimeID: "dp_overflow"})
	if result, err := heartbeatRuntimeIDs(ids); err == nil || result != nil {
		t.Fatal("overflow must omit the entire ID inventory")
	}
	if result, err := heartbeatRuntimeStates(states); err == nil || result != nil {
		t.Fatal("overflow must omit the entire state inventory")
	}
}

func TestHeartbeatServiceInventoryNeverTruncates(t *testing.T) {
	runtime := composeRuntime{RuntimeID: "dp_project", Services: make([]composeService, 500)}
	if result, err := heartbeatRuntimeStates([]composeRuntime{runtime}); err != nil || len(result[0].Services) != 500 {
		t.Fatal("expected complete service inventory at limit")
	}
	runtime.Services = append(runtime.Services, composeService{Name: "extra"})
	if result, err := heartbeatRuntimeStates([]composeRuntime{runtime}); err == nil || result != nil {
		t.Fatal("overflow must omit state inventory rather than truncate services")
	}
}
