/**
 * src/App.tsx
 *
 * This file contains the primary business logic and UI code for the ToDo
 * application.
 */
import React, { useState, useEffect, type FormEvent } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import {
  AppBar, Toolbar, List, ListItem, ListItemText, ListItemIcon, Checkbox, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, TextField,
  Button, Fab, LinearProgress, Typography, IconButton, Grid
} from '@mui/material'
import { styled } from '@mui/system'
import AddIcon from '@mui/icons-material/Add'
import GitHubIcon from '@mui/icons-material/GitHub'
import useAsyncEffect from 'use-async-effect'
import NoMncModal from './components/NoMncModal/NoMncModal'
import pushdrop from 'pushdrop'
import {
  decrypt, encrypt, createAction, getTransactionOutputs, stampLogFormat
} from '@babbage/sdk-ts'
import checkForMetaNetClient from './utils/checkForMetaNetClient'
import { type Task, type Token } from './types/types'
// This stylesheet also uses this for themeing.
import './App.scss'

// This is the namespace address for the ToDo protocol
// You can create your own Bitcoin address to use, and customize this protocol
// for your own needs.
const TODO_PROTO_ADDR = '1ToDoDtKreEzbHYKFjmoBuduFmSXXUGZG'

// These are some basic styling rules for the React application.
// We are using MUI (https://mui.com) for all of our UI components (i.e. buttons and dialogs etc.).
const AppBarPlaceholder = styled('div')({
  height: '4em'
})

const NoItems = styled(Grid)({
  margin: 'auto',
  textAlign: 'center',
  marginTop: '5em'
})

const AddMoreFab = styled(Fab)({
  position: 'fixed',
  right: '1em',
  bottom: '1em',
  zIndex: 10
})

const LoadingBar = styled(LinearProgress)({
  margin: '1em'
})

const GitHubIconStyle = styled(IconButton)({
  color: '#ffffff'
})

const App: React.FC = () => {
  // These are some state variables that control the app's interface.
  const [isMncMissing, setIsMncMissing] = useState<boolean>(false)
  const [createOpen, setCreateOpen] = useState<boolean>(false)
  const [createTask, setCreateTask] = useState<string>('')
  const [createAmount, setCreateAmount] = useState<number>(1000)
  const [createLoading, setCreateLoading] = useState<boolean>(false)
  const [tasksLoading, setTasksLoading] = useState<boolean>(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [completeOpen, setCompleteOpen] = useState<boolean>(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [completeLoading, setCompleteLoading] = useState<boolean>(false)

  // Run a 1s interval for checking if MNC is running
  useAsyncEffect(() => {
    const intervalId = setInterval(async () => {
      const hasMNC = await checkForMetaNetClient()
      if (hasMNC === 0) {
        setIsMncMissing(true) // Open modal if MNC is not found
      } else {
        setIsMncMissing(false) // Ensure modal is closed if MNC is found
      }
    }, 1000)

    // Return a cleanup function
    return () => {
      clearInterval(intervalId)
    }
  }, [])

  // Creates a new ToDo token.
  // This function will run when the user clicks "OK" in the creation dialog.
  const handleCreateSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault() // Stop the HTML form from reloading the page.
    try {
      // Here, we handle some basic mistakes the user might have made.
      if (createTask === '') {
        toast.error('Enter a task to complete!')
        return
      }
      if (createAmount === 0 || isNaN(createAmount)) {
        toast.error('Enter an amount for the new task!')
        return
      }
      if (createAmount < 500) {
        toast.error('The amount must be more than 500 satoshis!')
        return
      }

      // Now, we start a loading bar before the encryption and heavy lifting.
      setCreateLoading(true)

      // We can take the user's input from the text field (their new task), and
      // encrypt it with a key that only they have. When we put the encrypted
      // value into a ToDo Bitcoin token, only the same user can get it back
      // later on, after creation.
      const encryptedTask = await encrypt({
        // The plaintext for encryption is what the user put into the text field
        plaintext: Uint8Array.from(Buffer.from(createTask)),
        // The protocolID and keyID are important. When users encrypt things, they can do so in different contexts. The protocolID is the "context" in which a user has encrypted something. When your app uses a new protocol, it can only do so with the permission of the user.
        protocolID: 'todo list',
        // The keyID can be used to enable multiple keys for different
        // operations within the same protocol.For our simple "todo list"
        // protocol, let's all just agree that the keyID should be "1".
        keyID: '1'
        // P.S. We'll need to use the exact same protocolID and keyID later,
        // when we want to decrypt the ToDo list items.Otherwise, the
        // decryption would fail.
      })

      // Here's the part where we create the new Bitcoin token.
      // This uses a library called PushDrop, which lets you attach data
      // payloads to Bitcoin token outputs.Then, you can redeem / unlock the
      // tokens later.
      const bitcoinOutputScript = await pushdrop.create({
        fields: [ // The "fields" are the data payload to attach to the token.
          // For more info on these fields, look at the ToDo protocol document
          // (PROTOCOL.md). Note that the PushDrop library handles the public
          // key, signature, and OP_DROP fields automatically.
          Buffer.from(TODO_PROTO_ADDR), // TODO protocol namespace address
          Buffer.from(encryptedTask) // TODO task (encrypted)
        ],
        // The same "todo list" protocol and key ID can be used to sign and
        // lock this new Bitcoin PushDrop token.
        protocolID: 'todo list',
        keyID: '1'
      })

      // Now that we have the output script for our ToDo Bitcoin token, we can
      // add it to a Bitcoin transaction (a.k.a. "Action"), and register the
      // new token with the blockchain. On the MetaNet, Actions are anything
      // that a user does, and all Actions take the form of Bitcoin
      // transactions.
      const newToDoToken = await createAction({
        // This Bitcoin transaction ("Action" with a capital A) has one output,
        // because it has led to the creation of a new Bitcoin token. The token
        // that gets created represents our new ToDo list item.
        outputs: [{
          // The output amount is how much Bitcoin (measured in "satoshis")
          // this token is worth. We use the value that the user entered in the
          // dialog box.
          satoshis: Number(createAmount),
          // The output script for this token was created by PushDrop library,
          // which you can see above.
          script: bitcoinOutputScript,
          // We can put the new output into a "basket" which will keep track of
          // it, so that we can get it back later.
          basket: 'todo tokens',
          // Lastly, we should describe this output for the user.
          description: 'New ToDo list item'
        }],
        // Describe the Actions that your app facilitates, in the present
        // tense, for the user's future reference.
        description: `Create a TODO task: ${createTask}`,
        log: ''
      })

      if (newToDoToken.log != null && newToDoToken.log !== '') {
        console.log(stampLogFormat(newToDoToken.log))
      }

      // Now, we just let the user know the good news! Their token has been
      // created, and added to the list.
      toast.dark('Task successfully created!')
      const txid = newToDoToken.txid ?? '' // Use nullish coalescing operator
      setTasks((originalTasks) => ([
        {
          task: createTask,
          sats: Number(createAmount),
          token: {
            ...newToDoToken,
            lockingScript: bitcoinOutputScript,
            txid,
            outputIndex: 0
          } as Token // Explicitly typing the token object
        },
        ...originalTasks
      ]))
      setCreateTask('')
      setCreateAmount(1000)
      setCreateOpen(false)
    } catch (e) {
      // Any errors are shown on the screen and printed in the developer console
      toast.error((e as Error).message)
      console.error(e)
    } finally {
      setCreateLoading(false)
    }
  }

  // Redeems the ToDo toeken, marking the selected task as completed.
  // This function runs when the user clicks the "complete" button on the
  // completion dialog.
  const handleCompleteSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault() // Stop the HTML form from reloading the page.
    try {
      // Start a loading bar to let the user know we're working on it.
      setCompleteLoading(true)

      // Here, we're using the PushDrop library to unlcok / redeem the PushDrop
      // token that was previously created. By providing this information,
      // PushDrop can "unlock" and spend the token. When the token gets spent,
      // the user gets their bitcoins back, and the ToDo token is removed from
      // the list.
      const unlockingScript = await pushdrop.redeem({
        // To unlock the token, we need to use the same "todo list" protocolID
        // and keyID as when we created the ToDo token before. Otherwise, the
        // key won't fit the lock and the Bitcoins won't come out.
        protocolID: 'todo list',
        keyID: '1',
        // We're telling PushDrop which previous transaction and output we want
        // to unlock, so that the correct unlocking puzzle can be prepared.
        prevTxId: selectedTask?.token.txid,
        outputIndex: selectedTask?.token.outputIndex,
        // We also give PushDrop a copy of the locking puzzle ("script") that
        // we want to open, which is helpful in preparing to unlock it.
        lockingScript: selectedTask?.token.lockingScript,
        // Finally, the amount of Bitcoins we are expecting to unlock when the
        // puzzle gets solved.
        outputAmount: selectedTask?.sats
      })

      // Let the user know what's going on, and why they're getting some
      // Bitcoins back.
      let description = `Complete a TODO task: "${selectedTask?.task}"`
      if (description.length > 128) { description = description.substring(0, 128) }

      /** * SHOULD CHECKS BE PERFORMED BEFORE USE? ***/
      // Now, we're going to use the unlocking puzle that PushDrop has prepared
      // for us, so that the user can get their Bitcoins back.This is another
      // "Action", which is just a Bitcoin transaction.
      if (selectedTask === null) {
        throw new Error('No task selected.')
      }

      // Check all arguments are defined
      if (selectedTask.token?.txid === '' || selectedTask.token.outputIndex === undefined) {
        throw new Error('Task data is incomplete or undefined.')
      }

      const r = await createAction({
        description,
        inputs: { // These are inputs, which unlock Bitcoin tokens.
          // The input comes from the previous ToDo token, which we're now
          // completing, redeeming and spending.
          [selectedTask.token.txid]: {
            ...selectedTask.token,
            // The output we want to redeem is specified here, and we also give
            // the unlocking puzzle ("script") from PushDrop.
            outputsToRedeem: [{
              index: selectedTask.token.outputIndex,
              unlockingScript,
              // Spending descriptions tell the user why this input was redeemed
              spendingDescription: 'Complete a ToDo list item'
            }]
          }
        },
        log: ''
      })

      if (r.log != null && r.log !== '') {
        console.log(stampLogFormat(r.log))
      }

      // Finally, we let the user know about the good news, and that their
      // completed ToDo token has been removed from their list! The satoshis
      // have now been unlocked, and are back in their posession.
      toast.dark('Congrats! Task complete 🎉')
      setTasks((oldTasks) => {
        const index = oldTasks.findIndex(x => x === selectedTask)
        if (index > -1) oldTasks.splice(index, 1)
        return [...oldTasks]
      })
      setSelectedTask(null)
      setCompleteOpen(false)
    } catch (e) {
      toast.error(`Error completing task: ${(e as Error).message}`)
      console.error(e)
    } finally {
      setCompleteLoading(false)
    }
  }

  // This loads a user's existing ToDo tokens from their token basket
  // whenever the page loads. This populates their ToDo list.
  // A basket is just a way to keep track of different kinds of Bitcoin tokens.
  useEffect(() => {
    void (async () => {
      try {
        // We use a function called "getTransactionOutputs" to fetch this
        // user's current ToDo tokens from their basket. Tokens are just a way
        // to represent something of value, like a task that needs to be
        // completed.
        const tasksFromBasket = await getTransactionOutputs({
          // The name of the basket where the tokens are kept
          basket: 'todo tokens',
          // Only get tokens that are active on the list, not already complete
          spendable: true,
          // Also get the envelope needed if we complete (spend) the ToDo token
          includeEnvelope: true
        })

        // Now that we have the data (in the tasksFromBasket variable), we will
        // decode and decrypt the tasks we got from the basket.When the tasks
        // were created, they were encrypted so that only this user could read
        // them.Here, the encryption process is reversed.
        const decryptedTasks = await Promise.all(tasksFromBasket.map(async (task: any) => {
          try {
            // Each "task" from the array has some useful information that we
            // can decode and decrypt, so that the task can be shown on the
            // screen.Other fields are useful if we want to spend the token
            // later.

            // We can decode the locking script (a.k.a. output script) back
            // into the "fields" that we originally gave to PushDrop when the
            // token was created.
            const decodedTask = pushdrop.decode({ script: task.outputScript })

            // As you can tell if you look at the fields we sent into
            // PushDrop when the token was originally created, the encrypted
            // copy of the task is the second field from the fields array,
            // after the TODO_PROTO_ADDR prefix.
            const encryptedTask = decodedTask.fields[1]

            // We'll pass in the encrypted value from the token, and
            // use the "todo list" protocol and key ID for decrypting.
            // NOTE: The same protocolID and keyID must be used when you
            // encrypt and decrypt any data. Decrypting with the wrong
            // protocolID or keyID would result in an error.
            const decryptedTask = await decrypt({
              ciphertext: Buffer.from(encryptedTask as string, 'hex'),
              protocolID: 'todo list',
              keyID: '1',
              returnType: 'string'
            })

            // Now we can return the decrypted version of the task, along
            // with some information about the token.
            return {
              // We keep the token's locking script (a.k.a. output script),
              // previous transaction ID (txid), and vout (a.k.a.previous
              // outputIndex), which are useful if the user decides they
              // want to "unlock" / redeem / spend this ToDo token.
              token: {
                ...task.envelope,
                lockingScript: task.outputScript,
                txid: task.txid,
                outputIndex: task.vout
              },
              // The "sats" (satoshis) are the amount of Bitcoin in the
              // token, for showing on the screen to the user
              sats: task.amount,
              // Finally, we include the task that we've just decrypted, for
              // showing on- screen in the ToDo list.
              task: decryptedTask
            }
          } catch (e) {
            // In case there are any errors, we'll handle them gracefully.
            console.error('Error decrypting task:', e)
            return {
              ...task,
              task: '[error] Unable to decrypt task!'
            }
          }
        }))

        // We reverse the list, so the newest tasks show up at the top
        setTasks(decryptedTasks.reverse())
      } catch (e) {
        // Any larger errors are also handled. If these steps fail, maybe the
        // user didn't give our app the right permissions, and we couldn't use
        // the "todo list" protocol.

        // Check if the error code is related to missing MNC and supress.
        // MNC is being polled until it is launched so no error message is required.
        const errorCode = (e as any).code
        if (errorCode !== 'ERR_NO_METANET_IDENTITY') {
          toast.error(`Failed to load ToDo tasks! Error: ${(e as Error).message}`)
          console.error(e)
        }
      } finally {
        setTasksLoading(false)
      }
    })()
  }, [])

  // The rest of this file just contains some UI code. All the juicy
  // Bitcoin - related stuff is above.

  // ----------

  // Opens the completion dialog for the selected task
  const openCompleteModal = (task: Task) => () => {
    setSelectedTask(task)
    setCompleteOpen(true)
  }

  return (
    <>
      <NoMncModal open={isMncMissing} onClose={() => { setIsMncMissing(false) }} />
      <ToastContainer
        position='top-right'
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      <AppBar position='static'>
        <Toolbar>
          <Typography variant='h6' component='div' sx={{ flexGrow: 1 }}>
            ToDo List — Get Rewarded!
          </Typography>
          <GitHubIconStyle onClick={() => window.open('https://github.com/p2ppsr/todo-react', '_blank')}>
            <GitHubIcon />
          </GitHubIconStyle>
        </Toolbar>
      </AppBar>
      <AppBarPlaceholder />

      {tasks.length >= 1 && (
        <AddMoreFab color='primary' onClick={() => { setCreateOpen(true) }}>
          <AddIcon />
        </AddMoreFab>
      )}

      {tasksLoading
        ? (<LoadingBar />)
        : (
          <List>
            {tasks.length === 0 && (
              <NoItems container direction='column' justifyContent='center' alignItems='center'>
                <Grid item align='center'>
                  <Typography variant='h4'>No ToDo Items</Typography>
                  <Typography color='textSecondary'>
                        Use the button below to start a task
                  </Typography>
                </Grid>
                <Grid item align='center' sx={{ paddingTop: '2.5em', marginBottom: '1em' }}>
                  <Fab color='primary' onClick={() => { setCreateOpen(true) }}>
                    <AddIcon />
                  </Fab>
                </Grid>
              </NoItems>
            )}
            {tasks.map((x, i) => (
              <ListItem key={i} button onClick={openCompleteModal(x)}>
                <ListItemIcon><Checkbox checked={false} /></ListItemIcon>
                <ListItemText primary={x.task} secondary={`${x.sats} satoshis`} />
              </ListItem>
            ))}
          </List>
          )
      }

      <Dialog open={createOpen} onClose={() => { setCreateOpen(false) }}>
        <form onSubmit={(e) => {
          e.preventDefault()
          void (async () => {
            try {
              await handleCreateSubmit(e)
            } catch (error) {
              console.error('Error in form submission:', error)
            }
          })()
        }}>
          <DialogTitle>Create a Task</DialogTitle>
          <DialogContent>
            <DialogContentText paragraph>
              Describe your task and set aside some satoshis you&apos;ll get back once it&apos;s done.
            </DialogContentText>
            <TextField
              multiline rows={3} fullWidth autoFocus
              label='Task to complete'
              onChange={(e: { target: { value: React.SetStateAction<string> } }) => { setCreateTask(e.target.value) }}
              value={createTask}
            />
            <br /><br />
            <TextField
              fullWidth type='number' min={100}
              label='Completion amount'
              onChange={(e: { target: { value: any } }) => { setCreateAmount(Number(e.target.value)) }}
              value={createAmount}
            />
          </DialogContent>
          {createLoading
            ? (<LoadingBar />)
            : (
              <DialogActions>
                <Button onClick={() => { setCreateOpen(false) }}>Cancel</Button>
                <Button type='submit'>OK</Button>
              </DialogActions>
              )
          }
        </form>
      </Dialog>

      <Dialog open={completeOpen} onClose={() => { setCompleteOpen(false) }}>
        <form onSubmit={(e) => {
          e.preventDefault()
          void (async () => {
            try {
              await handleCompleteSubmit(e)
            } catch (error) {
              console.error('Error in form submission:', error)
            }
          })()
        }}>
          <DialogTitle>Complete &quot;{selectedTask?.task}&quot;?</DialogTitle>
          <DialogContent>
            <DialogContentText paragraph>
              By marking this task as complete, you&apos;ll receive back your {selectedTask?.sats} satoshis.
            </DialogContentText>
          </DialogContent>
          {completeLoading
            ? (<LoadingBar />)
            : (
              <DialogActions>
                <Button onClick={() => { setCompleteOpen(false) }}>Cancel</Button>
                <Button type='submit'>Complete Task</Button>
              </DialogActions>
              )
          }
        </form>
      </Dialog>
    </>
  )
}

export default App
